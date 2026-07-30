import cors from "cors";
import "dotenv/config";
import express from "express";
import { createClient } from "@supabase/supabase-js";

type PairingImportRow = {
  mentor_name: string;
  mentee_name: string;
  dynasty: string;
};

type PairingImportRequest = {
  pairings: PairingImportRow[];
};

type ImportConflict = {
  rowNumber: number;
  memberName: string;
  role: "mentor" | "mentee";
  message: string;
};

type PairingImportResult = {
  rowNumber: number;
  inserted: boolean;
  skipped: ImportConflict[];
};

type MemberRow = {
  id: string;
  created_at: string;
  member_name: string;
  member_big: string | null;
  dynasty: string;
  is_dynasty_head: boolean | null;
};

type MemberInsert = {
  member_name: string;
  member_big: string | null;
  dynasty: string;
};

const app = express();
const port = Number(process.env.PORT ?? 3000);
const allowedOrigins = process.env.CORS_ORIGIN
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SECRET_KEY;
const membersTable = process.env.SUPABASE_MEMBERS_TABLE ?? "members";

app.use(
  cors({
    origin: allowedOrigins?.length ? allowedOrigins : true,
  }),
);
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    databaseConfigured: Boolean(supabaseUrl && supabaseServiceRoleKey),
  });
});

app.get("/api/members", async (_request, response) => {
  const supabase = getSupabaseClient();

  if (!supabase) {
    response.status(500).json({
      error:
        "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY in apps/api/.env.",
    });
    return;
  }

  const { data, error } = await supabase
    .from(membersTable)
    .select("id, created_at, member_name, member_big, dynasty, is_dynasty_head")
    .order("created_at", { ascending: true });

  if (error) {
    response.status(500).json({ error: error.message });
    return;
  }

  response.json({
    members: (data ?? []) as MemberRow[],
  });
});

app.post("/api/pairings/import", async (request, response) => {
  const supabase = getSupabaseClient();

  if (!supabase) {
    response.status(500).json({
      error:
        "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY in apps/api/.env.",
    });
    return;
  }

  const pairings = parsePairingImportRequest(request.body);

  if (!pairings) {
    response.status(400).json({
      error:
        "Request body must be an object with a non-empty pairings array containing mentor_name, mentee_name, and dynasty.",
    });
    return;
  }

  const memberNames = new Set<string>();

  pairings.forEach((pairing) => {
    memberNames.add(pairing.mentor_name);
    memberNames.add(pairing.mentee_name);
  });

  const { data: existingMembers, error: existingMembersError } = await supabase
    .from(membersTable)
    .select("member_name")
    .in("member_name", [...memberNames]);

  if (existingMembersError) {
    response.status(500).json({ error: existingMembersError.message });
    return;
  }

  const existingNames = new Set(
    (existingMembers ?? []).map((member) => member.member_name),
  );

  const conflicts: ImportConflict[] = [];
  const resultsByRow = new Map<number, PairingImportResult>();

  pairings.forEach((pairing, index) => {
    const rowNumber = index + 2;
    const skipped: ImportConflict[] = [];

    if (existingNames.has(pairing.mentor_name)) {
      skipped.push({
        rowNumber,
        memberName: pairing.mentor_name,
        role: "mentor",
        message: `${pairing.mentor_name} already exists in the database as a member.`,
      });
    }

    if (existingNames.has(pairing.mentee_name)) {
      skipped.push({
        rowNumber,
        memberName: pairing.mentee_name,
        role: "mentee",
        message: `${pairing.mentee_name} already exists in the database as a member.`,
      });
    }

    skipped.forEach((conflict) => conflicts.push(conflict));
    resultsByRow.set(rowNumber, {
      rowNumber,
      inserted: false,
      skipped,
    });
  });

  const pendingInserts = new Map<string, MemberInsert>();

  pairings.forEach((pairing, index) => {
    const rowNumber = index + 2;
    let rowInserted = false;

    if (
      !existingNames.has(pairing.mentor_name) &&
      !pendingInserts.has(pairing.mentor_name)
    ) {
      pendingInserts.set(pairing.mentor_name, {
        member_name: pairing.mentor_name,
        member_big: null,
        dynasty: pairing.dynasty,
      });
      rowInserted = true;
    }

    if (
      !existingNames.has(pairing.mentee_name) &&
      !pendingInserts.has(pairing.mentee_name)
    ) {
      pendingInserts.set(pairing.mentee_name, {
        member_name: pairing.mentee_name,
        member_big: pairing.mentor_name,
        dynasty: pairing.dynasty,
      });
      rowInserted = true;
    }

    const currentResult = resultsByRow.get(rowNumber);

    if (currentResult) {
      currentResult.inserted = rowInserted;
    }
  });

  const inserts = [...pendingInserts.values()];

  if (inserts.length === 0) {
    response.json({
      insertedCount: 0,
      insertedMembers: [],
      skippedCount: conflicts.length,
      results: [...resultsByRow.values()],
    });
    return;
  }

  const { data: insertedMembers, error: insertError } = await supabase
    .from(membersTable)
    .insert(inserts)
    .select("id, created_at, member_name, member_big, dynasty, is_dynasty_head");

  if (insertError) {
    response.status(500).json({ error: insertError.message });
    return;
  }

  response.status(201).json({
    insertedCount: inserts.length,
    insertedMembers: (insertedMembers ?? []) as MemberRow[],
    skippedCount: conflicts.length,
    results: [...resultsByRow.values()],
  });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

function getSupabaseClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

function parsePairingImportRequest(
  value: unknown,
): PairingImportRow[] | null {
  if (!value || typeof value !== "object" || !("pairings" in value)) {
    return null;
  }

  const pairings = value.pairings;

  if (!Array.isArray(pairings) || pairings.length === 0) {
    return null;
  }

  const normalizedPairings = pairings.map((pairing) => {
    if (!pairing || typeof pairing !== "object") {
      return null;
    }

    const mentorName = getTrimmedString(pairing.mentor_name);
    const menteeName = getTrimmedString(pairing.mentee_name);
    const dynasty = getTrimmedString(pairing.dynasty);

    if (!mentorName || !menteeName || !dynasty) {
      return null;
    }

    return {
      mentor_name: mentorName,
      mentee_name: menteeName,
      dynasty,
    };
  });

  return normalizedPairings.every(Boolean)
    ? (normalizedPairings as PairingImportRow[])
    : null;
}

function getTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
