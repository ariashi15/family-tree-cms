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

type MemberUpdateRequest = {
  member_name: string;
  member_big: string | null;
  dynasty: string;
  is_dynasty_head: boolean;
  create_missing_mentor?: boolean;
};

type MemberCreateRequest = MemberUpdateRequest & {
  create_missing_mentor?: boolean;
};

const allowedDynasties = new Set(["fire", "water", "earth", "wind"]);

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

app.post("/api/members", async (request, response) => {
  const supabase = getSupabaseClient();

  if (!supabase) {
    response.status(500).json({
      error:
        "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY in apps/api/.env.",
    });
    return;
  }

  const creation = parseMemberCreateRequest(request.body);

  if (!creation) {
    response.status(400).json({
      error:
        "Request body must include member_name, member_big, dynasty, and is_dynasty_head.",
    });
    return;
  }

  const normalizedMemberName = creation.member_name.toLocaleLowerCase();
  const namesToCheck = new Set<string>([creation.member_name]);

  if (creation.member_big) {
    if (creation.member_big.toLocaleLowerCase() === normalizedMemberName) {
      response.status(400).json({
        error: "A member cannot list themself as their own mentor.",
      });
      return;
    }

    namesToCheck.add(creation.member_big);
  }

  const { data: existingMembers, error: existingMembersError } = await supabase
    .from(membersTable)
    .select("id, member_name")
    .in("member_name", [...namesToCheck]);

  if (existingMembersError) {
    response.status(500).json({ error: existingMembersError.message });
    return;
  }

  const existingByLowerName = new Map(
    (existingMembers ?? []).map((member) => [
      member.member_name.toLocaleLowerCase(),
      member,
    ]),
  );

  if (existingByLowerName.has(normalizedMemberName)) {
    response.status(409).json({
      error: `${creation.member_name} already exists in the database as a member.`,
    });
    return;
  }

  const mentorName = creation.member_big;
  const normalizedMentorName = mentorName?.toLocaleLowerCase();
  const mentorExists = normalizedMentorName
    ? existingByLowerName.has(normalizedMentorName)
    : true;

  if (mentorName && !mentorExists && !creation.create_missing_mentor) {
    response.status(409).json({
      error: `${mentorName} does not exist in the database as a member yet.`,
      missingMentorName: mentorName,
      requiresMentorConfirmation: true,
    });
    return;
  }

  const inserts: MemberInsert[] = [];

  if (mentorName && !mentorExists) {
    inserts.push({
      member_name: mentorName,
      member_big: null,
      dynasty: creation.dynasty,
    });
  }

  inserts.push({
    member_name: creation.member_name,
    member_big: creation.member_big,
    dynasty: creation.dynasty,
  });

  const { data, error } = await supabase
    .from(membersTable)
    .insert(inserts)
    .select("id, created_at, member_name, member_big, dynasty, is_dynasty_head");

  if (error) {
    response.status(500).json({ error: error.message });
    return;
  }

  const createdMembers = (data ?? []) as MemberRow[];
  const createdMember = createdMembers.find(
    (member) =>
      member.member_name.toLocaleLowerCase() === normalizedMemberName,
  );

  response.status(201).json({
    member: createdMember,
    createdMentor:
      mentorName && !mentorExists
        ? createdMembers.find(
            (member) =>
              member.member_name.toLocaleLowerCase() === normalizedMentorName,
          ) ?? null
        : null,
  });
});

app.patch("/api/members/:id", async (request, response) => {
  const supabase = getSupabaseClient();

  if (!supabase) {
    response.status(500).json({
      error:
        "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY in apps/api/.env.",
    });
    return;
  }

  const memberId = getTrimmedString(request.params.id);
  const updates = parseMemberUpdateRequest(request.body);

  if (!memberId) {
    response.status(400).json({ error: "A member id is required." });
    return;
  }

  if (!updates) {
    response.status(400).json({
      error:
        "Request body must include member_name, member_big, dynasty, and is_dynasty_head.",
    });
    return;
  }

  const { data: currentMember, error: currentMemberError } = await supabase
    .from(membersTable)
    .select("id, member_name, member_big, dynasty")
    .eq("id", memberId)
    .single();

  if (currentMemberError || !currentMember) {
    response.status(404).json({ error: "That member could not be found." });
    return;
  }

  const normalizedMemberName = updates.member_name.toLocaleLowerCase();
  const normalizedCurrentMemberName =
    currentMember.member_name.toLocaleLowerCase();

  if (normalizedMemberName !== normalizedCurrentMemberName) {
    const { data: duplicateMembers, error: duplicateMembersError } =
      await supabase
        .from(membersTable)
        .select("id, member_name")
        .ilike("member_name", updates.member_name);

    if (duplicateMembersError) {
      response.status(500).json({ error: duplicateMembersError.message });
      return;
    }

    const duplicateMember = (duplicateMembers ?? []).find(
      (member) =>
        member.id !== memberId &&
        member.member_name.toLocaleLowerCase() === normalizedMemberName,
    );

    if (duplicateMember) {
      response.status(409).json({
        error: `${updates.member_name} already exists in the database as a member.`,
      });
      return;
    }
  }

  let createdMentor: MemberRow | null = null;
  let existingMentor: Pick<MemberRow, "id" | "member_name" | "dynasty"> | null = null;
  const { create_missing_mentor: createMissingMentor, ...memberUpdates } =
    updates;

  if (updates.member_big) {
    if (updates.member_big.toLocaleLowerCase() === normalizedMemberName) {
      response.status(400).json({
        error: "A member cannot list themself as their own mentor.",
      });
      return;
    }

    const { data: mentorMembers, error: mentorMembersError } = await supabase
      .from(membersTable)
      .select("id, member_name")
      .ilike("member_name", updates.member_big);

    if (mentorMembersError) {
      response.status(500).json({ error: mentorMembersError.message });
      return;
    }

    const matchingMentor = (mentorMembers ?? []).find(
      (member) =>
        member.member_name.toLocaleLowerCase() ===
        updates.member_big!.toLocaleLowerCase(),
    );

    if (matchingMentor) {
      const { data: mentorRow, error: mentorRowError } = await supabase
        .from(membersTable)
        .select("id, member_name, dynasty")
        .eq("id", matchingMentor.id)
        .single();

      if (mentorRowError) {
        response.status(500).json({ error: mentorRowError.message });
        return;
      }

      existingMentor = mentorRow as Pick<MemberRow, "id" | "member_name" | "dynasty">;
    }

    if (!matchingMentor) {
      if (!createMissingMentor) {
        response.status(409).json({
          error: `${updates.member_big} does not exist in the database as a member yet.`,
          missingMentorName: updates.member_big,
          requiresMentorConfirmation: true,
        });
        return;
      }

      const { data: createdMentorRows, error: createMentorError } = await supabase
        .from(membersTable)
        .insert({
          member_name: updates.member_big,
          member_big: null,
          dynasty: updates.dynasty,
        })
        .select("id, created_at, member_name, member_big, dynasty, is_dynasty_head");

      if (createMentorError) {
        response.status(500).json({ error: createMentorError.message });
        return;
      }

      createdMentor = ((createdMentorRows ?? [])[0] ?? null) as MemberRow | null;
    }
  }

  const { data, error } = await supabase
    .from(membersTable)
    .update(memberUpdates)
    .eq("id", memberId)
    .select("id, created_at, member_name, member_big, dynasty, is_dynasty_head")
    .single();

  if (error) {
    response.status(500).json({ error: error.message });
    return;
  }

  if (currentMember.member_name !== updates.member_name) {
    const { error: cascadeError } = await supabase
      .from(membersTable)
      .update({ member_big: updates.member_name })
      .eq("member_big", currentMember.member_name);

    if (cascadeError) {
      response.status(500).json({ error: cascadeError.message });
      return;
    }
  }

  if (currentMember.dynasty !== updates.dynasty) {
    const { data: familyRows, error: familyRowsError } = await supabase
      .from(membersTable)
      .select("id, member_name, member_big");

    if (familyRowsError) {
      response.status(500).json({ error: familyRowsError.message });
      return;
    }

    const graphMembers = (familyRows ?? []) as Pick<
      MemberRow,
      "id" | "member_name" | "member_big"
    >[];

    if (createdMentor) {
      graphMembers.push({
        id: createdMentor.id,
        member_name: createdMentor.member_name,
        member_big: createdMentor.member_big,
      });
    }

    const relatedMembers = getConnectedFamilyMembers(
      graphMembers,
      memberId,
      updates.member_name,
      updates.member_big,
    );

    for (const relatedMember of relatedMembers) {
      const { error: relativeDynastyError } = await supabase
        .from(membersTable)
        .update({ dynasty: updates.dynasty })
        .eq("id", relatedMember.id);

      if (relativeDynastyError) {
        response.status(500).json({ error: relativeDynastyError.message });
        return;
      }
    }
  }

  if (currentMember.member_big !== updates.member_big && updates.member_big) {
    if (existingMentor) {
      const { data: familyRows, error: familyRowsError } = await supabase
        .from(membersTable)
        .select("id, member_name, member_big");

      if (familyRowsError) {
        response.status(500).json({ error: familyRowsError.message });
        return;
      }

      const graphMembers = (familyRows ?? []) as Pick<
        MemberRow,
        "id" | "member_name" | "member_big"
      >[];

      const descendantMembers = getDescendantFamilyMembers(
        graphMembers,
        memberId,
        updates.member_name,
      );

      const membersToUpdate = [String(memberId), ...descendantMembers.map((member) => member.id)];

      const { error: dynastyInheritanceError } = await supabase
        .from(membersTable)
        .update({ dynasty: existingMentor.dynasty })
        .in("id", membersToUpdate);

      if (dynastyInheritanceError) {
        response.status(500).json({ error: dynastyInheritanceError.message });
        return;
      }
    }
  }

  response.json({
    member: data as MemberRow,
    createdMentor,
  });
});

app.delete("/api/members/:id", async (request, response) => {
  const supabase = getSupabaseClient();

  if (!supabase) {
    response.status(500).json({
      error:
        "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY in apps/api/.env.",
    });
    return;
  }

  const memberId = getTrimmedString(request.params.id);

  if (!memberId) {
    response.status(400).json({ error: "A member id is required." });
    return;
  }

  const { data: currentMember, error: currentMemberError } = await supabase
    .from(membersTable)
    .select("id, member_name")
    .eq("id", memberId)
    .single();

  if (currentMemberError || !currentMember) {
    response.status(404).json({ error: "That member could not be found." });
    return;
  }

  const { error: clearMentorError } = await supabase
    .from(membersTable)
    .update({ member_big: null })
    .eq("member_big", currentMember.member_name);

  if (clearMentorError) {
    response.status(500).json({ error: clearMentorError.message });
    return;
  }

  const { error } = await supabase.from(membersTable).delete().eq("id", memberId);

  if (error) {
    response.status(500).json({ error: error.message });
    return;
  }

  response.status(204).send();
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

function getConnectedFamilyMembers(
  members: Pick<MemberRow, "id" | "member_name" | "member_big">[],
  rootMemberId: string,
  updatedMemberName: string,
  updatedMemberBig: string | null,
) {
  const normalizedRootMemberId = String(rootMemberId);
  const nodes = members.map((member) =>
    String(member.id) === normalizedRootMemberId
      ? {
          ...member,
          id: String(member.id),
          member_name: updatedMemberName,
          member_big: updatedMemberBig,
        }
      : {
          ...member,
          id: String(member.id),
        },
  );
  const byId = new Map(nodes.map((member) => [member.id, member]));
  const adjacency = new Map<string, Set<string>>();
  const byName = new Map(
    nodes.map((member) => [member.member_name.toLocaleLowerCase(), member.id]),
  );

  nodes.forEach((member) => {
    adjacency.set(member.id, adjacency.get(member.id) ?? new Set());
  });

  nodes.forEach((member) => {
    if (!member.member_big) return;

    const bigId = byName.get(member.member_big.toLocaleLowerCase());

    if (!bigId) return;

    adjacency.get(member.id)?.add(bigId);
    adjacency.get(bigId)?.add(member.id);
  });

  const visited = new Set<string>();
  const queue = [normalizedRootMemberId];

  while (queue.length > 0) {
    const currentId = queue.shift();

    if (!currentId || visited.has(currentId) || !byId.has(currentId)) {
      continue;
    }

    visited.add(currentId);

    adjacency.get(currentId)?.forEach((neighborId) => {
      if (!visited.has(neighborId)) {
        queue.push(neighborId);
      }
    });
  }

  visited.delete(rootMemberId);

  const relatedMembers: Pick<MemberRow, "id" | "member_name" | "member_big">[] = [];

  visited.forEach((memberId) => {
    const member = byId.get(memberId);

    if (member) {
      relatedMembers.push(member);
    }
  });

  return relatedMembers;
}

function getDescendantFamilyMembers(
  members: Pick<MemberRow, "id" | "member_name" | "member_big">[],
  rootMemberId: string,
  updatedMemberName: string,
) {
  const normalizedRootMemberId = String(rootMemberId);
  const nodes = members.map((member) =>
    String(member.id) === normalizedRootMemberId
      ? { ...member, id: String(member.id), member_name: updatedMemberName }
      : { ...member, id: String(member.id) },
  );
  const byName = new Map(
    nodes.map((member) => [member.member_name.toLocaleLowerCase(), member.id]),
  );
  const childrenByParentId = new Map<string, Set<string>>();

  nodes.forEach((member) => {
    const normalizedBig = member.member_big?.toLocaleLowerCase();

    if (!normalizedBig) return;

    const parentId = byName.get(normalizedBig);

    if (!parentId) return;

    childrenByParentId.set(
      parentId,
      (childrenByParentId.get(parentId) ?? new Set()).add(member.id),
    );
  });

  const visited = new Set<string>();
  const queue = [normalizedRootMemberId];

  while (queue.length > 0) {
    const currentId = queue.shift();

    if (!currentId || visited.has(currentId)) continue;

    visited.add(currentId);
    childrenByParentId.get(currentId)?.forEach((childId) => {
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    });
  }

  visited.delete(normalizedRootMemberId);

  return nodes.filter((member) => visited.has(member.id));
}

function parseMemberUpdateRequest(value: unknown): MemberUpdateRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;

  const memberName = getTrimmedString(payload.member_name);
  const memberBigRaw = payload.member_big;
  const memberBig =
    memberBigRaw === null ? null : getTrimmedString(memberBigRaw) || null;
  const dynasty = getTrimmedString(payload.dynasty).toLowerCase();
  const isDynastyHead = payload.is_dynasty_head;

  if (
    !memberName ||
    !allowedDynasties.has(dynasty) ||
    typeof isDynastyHead !== "boolean"
  ) {
    return null;
  }

  return {
    member_name: memberName,
    member_big: memberBig,
    dynasty,
    is_dynasty_head: isDynastyHead,
    create_missing_mentor:
      typeof payload.create_missing_mentor === "boolean"
        ? payload.create_missing_mentor
        : false,
  };
}

function parseMemberCreateRequest(value: unknown): MemberCreateRequest | null {
  const parsedUpdate = parseMemberUpdateRequest(value);

  if (!parsedUpdate || !value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const createMissingMentor = payload.create_missing_mentor;

  return {
    ...parsedUpdate,
    create_missing_mentor:
      typeof createMissingMentor === "boolean" ? createMissingMentor : false,
  };
}
