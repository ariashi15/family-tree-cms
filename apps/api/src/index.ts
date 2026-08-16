import cors from "cors";
import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

type AdminRole = "super_admin" | "admin";

type AdminUserRow = {
  email: string;
  user_id: string | null;
  is_active: boolean;
  admin_role: AdminRole;
};

type AdminUserInput = {
  email: string;
  admin_role: AdminRole;
  is_active: boolean;
};

type PairingImportRow = {
  big_name: string;
  little_name: string;
  dynasty: string;
};

type PairingImportRequest = {
  pairings: PairingImportRow[];
};

type ImportConflict = {
  rowNumber: number;
  memberName: string;
  role: "big" | "little";
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
  create_missing_big?: boolean;
};

type MemberCreateRequest = MemberUpdateRequest & {
  create_missing_big?: boolean;
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
const adminUsersTable = process.env.SUPABASE_ADMIN_USERS_TABLE ?? "admin_users";

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

app.get("/api/public/members", listMembers);

app.post("/api/auth/claim-access", requireAuthenticatedUser, claimAdminAccess);

app.use("/api/members", requireAuthenticatedUser, requireApprovedAdmin);
app.use("/api/pairings/import", requireAuthenticatedUser, requireApprovedAdmin);
app.use(
  "/api/admin-users",
  requireAuthenticatedUser,
  requireApprovedAdmin,
  requireSuperAdmin,
);

app.get("/api/members", listMembers);
app.get("/api/admin-users", listAdminUsers);
app.post("/api/admin-users", createAdminUser);
app.patch("/api/admin-users", updateAdminUser);

async function listMembers(
  _request: Request,
  response: Response,
) {
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
}

async function claimAdminAccess(_request: Request, response: Response) {
  const supabase = getSupabaseClient();
  const user = response.locals.authUser as User | undefined;

  if (!supabase || !user) {
    response.status(500).json({ error: "Admin access could not be verified." });
    return;
  }

  const normalizedEmail = normalizeEmail(user.email);

  if (!normalizedEmail) {
    response.status(403).json({
      error: "This account does not have an email address, so CMS access cannot be verified.",
    });
    return;
  }

  const { data: linkedAdmin, error: linkedAdminError } = await supabase
    .from(adminUsersTable)
    .select("email, user_id, is_active, admin_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (linkedAdminError) {
    response.status(500).json({ error: "Admin access could not be verified." });
    return;
  }

  if (linkedAdmin) {
    if (!isApprovedAdminRow(linkedAdmin)) {
      response.status(403).json({ error: "Your account is not approved for CMS access." });
      return;
    }

    response.json({
      admin: {
        email: linkedAdmin.email,
        adminRole: linkedAdmin.admin_role,
      },
    });
    return;
  }

  const { data: pendingAdmin, error: pendingAdminError } = await supabase
    .from(adminUsersTable)
    .select("email, user_id, is_active, admin_role")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (pendingAdminError) {
    response.status(500).json({ error: "Admin access could not be verified." });
    return;
  }

  if (!pendingAdmin || !isApprovedAdminRow(pendingAdmin)) {
    response.status(403).json({ error: "Your account is not approved for CMS access." });
    return;
  }

  if (pendingAdmin.user_id && pendingAdmin.user_id !== user.id) {
    response.status(403).json({
      error: "This approved email is already linked to a different account.",
    });
    return;
  }

  const { data: claimedAdmin, error: claimError } = await supabase
    .from(adminUsersTable)
    .update({ user_id: user.id })
    .eq("email", normalizedEmail)
    .is("user_id", null)
    .select("email, user_id, is_active, admin_role")
    .single();

  if (claimError || !claimedAdmin || !isApprovedAdminRow(claimedAdmin)) {
    response.status(409).json({
      error: "Admin access could not be linked to this account. Please try again or contact a super admin.",
    });
    return;
  }

  response.json({
    admin: {
      email: claimedAdmin.email,
      adminRole: claimedAdmin.admin_role,
    },
  });
}

async function listAdminUsers(_request: Request, response: Response) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    response.status(500).json({ error: "Admin users could not be loaded." });
    return;
  }

  const { data, error } = await supabase
    .from(adminUsersTable)
    .select("email, user_id, is_active, admin_role")
    .order("email", { ascending: true });

  if (error) {
    response.status(500).json({ error: "Admin users could not be loaded." });
    return;
  }

  response.json({ adminUsers: (data ?? []) as AdminUserRow[] });
}

async function createAdminUser(request: Request, response: Response) {
  const supabase = getSupabaseClient();
  const input = parseAdminUserInput(request.body);

  if (!supabase) {
    response.status(500).json({ error: "The admin user could not be saved." });
    return;
  }

  if (!input) {
    response.status(400).json({
      error: "A valid email, admin role, and active status are required.",
    });
    return;
  }

  const { data: existingAdmin, error: existingAdminError } = await supabase
    .from(adminUsersTable)
    .select("email")
    .eq("email", input.email)
    .maybeSingle();

  if (existingAdminError) {
    response.status(500).json({ error: "The admin user could not be saved." });
    return;
  }

  if (existingAdmin) {
    response.status(409).json({ error: `${input.email} is already an approved admin.` });
    return;
  }

  const { data, error } = await supabase
    .from(adminUsersTable)
    .insert({ ...input, user_id: null })
    .select("email, user_id, is_active, admin_role")
    .single();

  if (error || !data) {
    response.status(500).json({ error: "The admin user could not be saved." });
    return;
  }

  response.status(201).json({ adminUser: data as AdminUserRow });
}

async function updateAdminUser(request: Request, response: Response) {
  const supabase = getSupabaseClient();
  const input = parseAdminUserInput(request.body);
  const originalEmail = normalizeEmail(
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>).original_email
      : undefined,
  );

  if (!supabase) {
    response.status(500).json({ error: "The admin user could not be saved." });
    return;
  }

  if (!input || !originalEmail) {
    response.status(400).json({
      error: "The original email and valid updated admin fields are required.",
    });
    return;
  }

  const { data: currentAdmin, error: currentAdminError } = await supabase
    .from(adminUsersTable)
    .select("email, user_id")
    .eq("email", originalEmail)
    .maybeSingle();

  if (currentAdminError) {
    response.status(500).json({ error: "The admin user could not be saved." });
    return;
  }

  if (!currentAdmin) {
    response.status(404).json({ error: "That admin user could not be found." });
    return;
  }

  const emailChanged = input.email !== originalEmail;
  const { data, error } = await supabase
    .from(adminUsersTable)
    .update({
      ...input,
      user_id: emailChanged ? null : currentAdmin.user_id,
    })
    .eq("email", originalEmail)
    .select("email, user_id, is_active, admin_role")
    .single();

  if (error || !data) {
    response.status(500).json({ error: "The admin user could not be saved." });
    return;
  }

  response.json({ adminUser: data as AdminUserRow });
}

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
        error: "A member cannot list themself as their own big.",
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

  const bigName = creation.member_big;
  const normalizedbigName = bigName?.toLocaleLowerCase();
  const bigExists = normalizedbigName
    ? existingByLowerName.has(normalizedbigName)
    : true;

  if (bigName && !bigExists && !creation.create_missing_big) {
    response.status(409).json({
      error: `${bigName} does not exist in the database as a member yet.`,
      missingbigName: bigName,
      requiresbigConfirmation: true,
    });
    return;
  }

  const inserts: MemberInsert[] = [];

  if (bigName && !bigExists) {
    inserts.push({
      member_name: bigName,
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
    createdbig:
      bigName && !bigExists
        ? createdMembers.find(
            (member) =>
              member.member_name.toLocaleLowerCase() === normalizedbigName,
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

  let createdbig: MemberRow | null = null;
  let existingbig: Pick<MemberRow, "id" | "member_name" | "dynasty"> | null = null;
  const { create_missing_big: createMissingbig, ...memberUpdates } =
    updates;

  if (updates.member_big) {
    if (updates.member_big.toLocaleLowerCase() === normalizedMemberName) {
      response.status(400).json({
        error: "A member cannot list themself as their own big.",
      });
      return;
    }

    const { data: bigMembers, error: bigMembersError } = await supabase
      .from(membersTable)
      .select("id, member_name")
      .ilike("member_name", updates.member_big);

    if (bigMembersError) {
      response.status(500).json({ error: bigMembersError.message });
      return;
    }

    const matchingbig = (bigMembers ?? []).find(
      (member) =>
        member.member_name.toLocaleLowerCase() ===
        updates.member_big!.toLocaleLowerCase(),
    );

    if (matchingbig) {
      const { data: bigRow, error: bigRowError } = await supabase
        .from(membersTable)
        .select("id, member_name, dynasty")
        .eq("id", matchingbig.id)
        .single();

      if (bigRowError) {
        response.status(500).json({ error: bigRowError.message });
        return;
      }

      existingbig = bigRow as Pick<MemberRow, "id" | "member_name" | "dynasty">;
    }

    const { data: familyRows, error: familyRowsError } = await supabase
      .from(membersTable)
      .select("id, member_name, member_big");

    if (familyRowsError) {
      response.status(500).json({ error: familyRowsError.message });
      return;
    }

    const wouldCreateCycle = createsBigCycle(
      (familyRows ?? []) as Pick<MemberRow, "id" | "member_name" | "member_big">[],
      memberId,
      updates.member_name,
      updates.member_big,
    );

    if (wouldCreateCycle) {
      response.status(400).json({
        error:
          "That big would create a cycle in the family tree. A member cannot become their own ancestor or descendant.",
      });
      return;
    }

    if (!matchingbig) {
      if (!createMissingbig) {
        response.status(409).json({
          error: `${updates.member_big} does not exist in the database as a member yet.`,
          missingbigName: updates.member_big,
          requiresbigConfirmation: true,
        });
        return;
      }

      const { data: createdbigRows, error: createbigError } = await supabase
        .from(membersTable)
        .insert({
          member_name: updates.member_big,
          member_big: null,
          dynasty: updates.dynasty,
        })
        .select("id, created_at, member_name, member_big, dynasty, is_dynasty_head");

      if (createbigError) {
        response.status(500).json({ error: createbigError.message });
        return;
      }

      createdbig = ((createdbigRows ?? [])[0] ?? null) as MemberRow | null;
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

    if (createdbig) {
      graphMembers.push({
        id: createdbig.id,
        member_name: createdbig.member_name,
        member_big: createdbig.member_big,
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
    if (existingbig) {
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
        .update({ dynasty: existingbig.dynasty })
        .in("id", membersToUpdate);

      if (dynastyInheritanceError) {
        response.status(500).json({ error: dynastyInheritanceError.message });
        return;
      }
    }
  }

  response.json({
    member: data as MemberRow,
    createdbig,
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

  const { error: clearbigError } = await supabase
    .from(membersTable)
    .update({ member_big: null })
    .eq("member_big", currentMember.member_name);

  if (clearbigError) {
    response.status(500).json({ error: clearbigError.message });
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
        "Request body must be an object with a non-empty pairings array containing big_name, little_name, and dynasty.",
    });
    return;
  }

  const memberNames = new Set<string>();

  pairings.forEach((pairing) => {
    memberNames.add(pairing.big_name);
    memberNames.add(pairing.little_name);
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

    if (existingNames.has(pairing.big_name)) {
      skipped.push({
        rowNumber,
        memberName: pairing.big_name,
        role: "big",
        message: `${pairing.big_name} already exists in the database as a member.`,
      });
    }

    if (existingNames.has(pairing.little_name)) {
      skipped.push({
        rowNumber,
        memberName: pairing.little_name,
        role: "little",
        message: `${pairing.little_name} already exists in the database as a member.`,
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
      !existingNames.has(pairing.big_name) &&
      !pendingInserts.has(pairing.big_name)
    ) {
      pendingInserts.set(pairing.big_name, {
        member_name: pairing.big_name,
        member_big: null,
        dynasty: pairing.dynasty,
      });
      rowInserted = true;
    }

    if (
      !existingNames.has(pairing.little_name) &&
      !pendingInserts.has(pairing.little_name)
    ) {
      pendingInserts.set(pairing.little_name, {
        member_name: pairing.little_name,
        member_big: pairing.big_name,
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

async function requireAuthenticatedUser(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    response.status(500).json({
      error:
        "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY in apps/api/.env.",
    });
    return;
  }

  const authorizationHeader = request.header("authorization");
  const authorizationParts = authorizationHeader?.trim().split(/\s+/) ?? [];

  if (
    authorizationParts.length !== 2 ||
    authorizationParts[0].toLocaleLowerCase() !== "bearer" ||
    !authorizationParts[1]
  ) {
    response.status(401).json({ error: "A valid sign-in session is required." });
    return;
  }

  const accessToken = authorizationParts[1];
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    response.status(401).json({ error: "Your sign-in session is invalid or has expired." });
    return;
  }

  response.locals.authUser = user;
  next();
}

async function requireApprovedAdmin(
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  const supabase = getSupabaseClient();
  const user = response.locals.authUser as User | undefined;

  if (!supabase || !user) {
    response.status(401).json({ error: "A valid sign-in session is required." });
    return;
  }

  const { data: adminUser, error: adminUserError } = await supabase
    .from(adminUsersTable)
    .select("user_id, email, is_active, admin_role")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (adminUserError) {
    response.status(500).json({ error: "Admin access could not be verified." });
    return;
  }

  if (
    !adminUser ||
    (adminUser.admin_role !== "admin" && adminUser.admin_role !== "super_admin")
  ) {
    response.status(403).json({ error: "Your account is not approved for CMS access." });
    return;
  }

  response.locals.adminUser = {
    userId: user.id,
    email: adminUser.email,
    adminRole: adminUser.admin_role,
  };
  next();
}

function requireSuperAdmin(
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  const adminUser = response.locals.adminUser as
    | { adminRole?: AdminRole }
    | undefined;

  if (adminUser?.adminRole !== "super_admin") {
    response.status(403).json({ error: "Super-admin access is required." });
    return;
  }

  next();
}

let supabaseClient: SupabaseClient | null | undefined;

function getSupabaseClient() {
  if (supabaseClient !== undefined) {
    return supabaseClient;
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase()
    : "";
}

function isApprovedAdminRow(value: unknown): value is AdminUserRow {
  if (!value || typeof value !== "object") return false;

  const row = value as Partial<AdminUserRow>;

  return (
    row.is_active === true &&
    (row.admin_role === "admin" || row.admin_role === "super_admin")
  );
}

function parseAdminUserInput(value: unknown): AdminUserInput | null {
  if (!value || typeof value !== "object") return null;

  const payload = value as Record<string, unknown>;
  const email = normalizeEmail(payload.email);
  const adminRole = payload.admin_role;
  const isActive = payload.is_active;

  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (adminRole !== "admin" && adminRole !== "super_admin") ||
    typeof isActive !== "boolean"
  ) {
    return null;
  }

  return {
    email,
    admin_role: adminRole,
    is_active: isActive,
  };
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

    const bigName = getTrimmedString(pairing.big_name);
    const littleName = getTrimmedString(pairing.little_name);
    const dynasty = getTrimmedString(pairing.dynasty);

    if (!bigName || !littleName || !dynasty) {
      return null;
    }

    return {
      big_name: bigName,
      little_name: littleName,
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

function createsBigCycle(
  members: Pick<MemberRow, "id" | "member_name" | "member_big">[],
  rootMemberId: string,
  updatedMemberName: string,
  proposedBigName: string,
) {
  const normalizedProposedBigName = proposedBigName.trim().toLocaleLowerCase();

  if (!normalizedProposedBigName) return false;

  const descendantMembers = getDescendantFamilyMembers(
    members,
    rootMemberId,
    updatedMemberName,
  );

  return descendantMembers.some(
    (member) =>
      member.member_name.trim().toLocaleLowerCase() === normalizedProposedBigName,
  );
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
    create_missing_big:
      typeof payload.create_missing_big === "boolean"
        ? payload.create_missing_big
        : false,
  };
}

function parseMemberCreateRequest(value: unknown): MemberCreateRequest | null {
  const parsedUpdate = parseMemberUpdateRequest(value);

  if (!parsedUpdate || !value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const createMissingbig = payload.create_missing_big;

  return {
    ...parsedUpdate,
    create_missing_big:
      typeof createMissingbig === "boolean" ? createMissingbig : false,
  };
}
