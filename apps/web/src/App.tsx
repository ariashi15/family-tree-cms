import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

const expectedColumns = ["mentor_name", "mentee_name", "dynasty"];
const allowedDynasties = ["fire", "water", "earth", "wind"] as const;
const apiUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type Tab = "members" | "bulk-upload";

type UploadState = "pending" | "uploaded" | "uploaded-with-skips" | "skipped";

type Pairing = {
  mentorName: string;
  menteeName: string;
  dynasty: string;
  rowNumber: number;
  errors: string[];
  notices: string[];
  uploadState: UploadState;
};

type ImportConflict = {
  rowNumber: number;
  memberName: string;
  role: "mentor" | "mentee";
  message: string;
};

type ImportSuccessResponse = {
  insertedCount: number;
  skippedCount: number;
  results: {
    rowNumber: number;
    inserted: boolean;
    skipped: ImportConflict[];
  }[];
};

type ApiErrorResponse = {
  error?: string;
};

type Member = {
  id: string;
  member_name: string;
  member_big: string | null;
  dynasty: (typeof allowedDynasties)[number];
  is_dynasty_head: boolean | null;
};

type MembersResponse = {
  members: Member[];
};

type MemberResponse = {
  member: Member;
  createdMentor?: Member | null;
};

type EditableMember = {
  id: string;
  memberName: string;
  memberBig: string;
  dynasty: (typeof allowedDynasties)[number];
  isDynastyHead: "true" | "false";
  isSaving: boolean;
  isDeleting: boolean;
  rowError: string;
};

type ConfirmDialogState =
  | {
      type: "save";
      memberId: string;
      createMissingMentor: boolean;
      summaryLines: string[];
      effectLines: string[];
    }
  | {
      type: "delete";
      memberId: string;
      memberName: string;
      summaryLines: string[];
      effectLines: string[];
    }
  | {
      type: "create-missing-mentor";
      mentorName: string;
      summaryLines: string[];
      effectLines: string[];
    }
  | null;

type NewMemberForm = {
  memberName: string;
  memberBig: string;
  dynasty: (typeof allowedDynasties)[number];
  isDynastyHead: "true" | "false";
  error: string;
  isSubmitting: boolean;
};

type UploadSuccessDialogState = {
  message: string;
} | null;

type MemberSnapshot = {
  memberName: string;
  memberBig: string;
  dynasty: (typeof allowedDynasties)[number];
  isDynastyHead: "true" | "false";
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (insideQuotes) {
      if (character === '"' && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        insideQuotes = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      insideQuotes = true;
    } else if (character === ",") {
      row.push(value.trim());
      value = "";
    } else if (character === "\n") {
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }

  if (insideQuotes) {
    throw new Error("The CSV contains an unclosed quoted value.");
  }

  if (value || row.length) {
    row.push(value.trim());
    rows.push(row);
  }

  return rows.filter((currentRow) =>
    currentRow.some((cell) => cell.trim() !== ""),
  );
}

function toEditableMember(member: Member): EditableMember {
  return {
    id: member.id,
    memberName: member.member_name,
    memberBig: member.member_big ?? "",
    dynasty: member.dynasty,
    isDynastyHead: member.is_dynasty_head ? "true" : "false",
    isSaving: false,
    isDeleting: false,
    rowError: "",
  };
}

function getFirstName(value: string) {
  return value.trim().split(/\s+/)[0]?.toLocaleLowerCase() ?? "";
}

function sortMembersByFirstName(memberList: EditableMember[]) {
  return [...memberList].sort((left, right) => {
    const firstNameComparison = getFirstName(left.memberName).localeCompare(
      getFirstName(right.memberName),
    );

    if (firstNameComparison !== 0) {
      return firstNameComparison;
    }

    return left.memberName.localeCompare(right.memberName);
  });
}

function formatBool(value: "true" | "false") {
  return value === "true" ? "Yes" : "No";
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>("members");

  const [members, setMembers] = useState<EditableMember[]>([]);
  const [membersError, setMembersError] = useState("");
  const [membersSuccess, setMembersSuccess] = useState("");
  const [isMembersLoading, setIsMembersLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [memberSnapshots, setMemberSnapshots] = useState<Record<string, MemberSnapshot>>(
    {},
  );
  const [newMemberForm, setNewMemberForm] = useState<NewMemberForm>({
    memberName: "",
    memberBig: "",
    dynasty: "fire",
    isDynastyHead: "false",
    error: "",
    isSubmitting: false,
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState("");
  const [uploadSuccessDialog, setUploadSuccessDialog] =
    useState<UploadSuccessDialogState>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    void loadMembers();
  }, []);

  async function loadMembers() {
    setIsMembersLoading(true);
    setMembersError("");

    try {
      const response = await fetch(`${apiUrl}/api/members`);
      const payload = (await response.json()) as MembersResponse | ApiErrorResponse;

      if (!response.ok) {
        setMembersError(
          "error" in payload && payload.error
            ? payload.error
            : "The member list could not be loaded.",
        );
        return;
      }

      setMembers(
        sortMembersByFirstName(
          (payload as MembersResponse).members.map(toEditableMember),
        ),
      );
      setMemberSnapshots(
        Object.fromEntries(
          (payload as MembersResponse).members.map((member) => [
            member.id,
            {
              memberName: member.member_name,
              memberBig: member.member_big ?? "",
              dynasty: member.dynasty,
              isDynastyHead: member.is_dynasty_head ? "true" : "false",
            } satisfies MemberSnapshot,
          ]),
        ),
      );
    } catch {
      setMembersError("The member list could not be loaded. Please check the API connection.");
    } finally {
      setIsMembersLoading(false);
    }
  }

  const selectFile = async (file?: File) => {
    setUploadError("");
    setUploadSuccessMessage("");
    setUploadSuccessDialog(null);
    setPairings([]);

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setSelectedFile(null);
      setUploadError("Choose a CSV file with a .csv extension.");
      return;
    }

    setSelectedFile(file);
    setIsReading(true);

    try {
      const parsedRows = parseCsv(await file.text());

      if (parsedRows.length < 2) {
        throw new Error("The CSV must include a header and at least one pairing.");
      }

      const headers = parsedRows[0].map((header, index) =>
        index === 0 ? header.replace(/^\uFEFF/, "") : header,
      );

      if (
        headers.length !== expectedColumns.length ||
        headers.some((header, index) => header !== expectedColumns[index])
      ) {
        throw new Error(
          `The header must be exactly: ${expectedColumns.join(", ")}.`,
        );
      }

      const mappedPairings = parsedRows.slice(1).map((row, index) => {
        const rowNumber = index + 2;
        const errors: string[] = [];
        const [mentorName = "", menteeName = "", dynasty = ""] = row;

        if (row.length !== expectedColumns.length) {
          errors.push(`This row has ${row.length} columns; exactly 3 are required.`);
        }

        if (!mentorName || !menteeName || !dynasty) {
          errors.push("Mentor, mentee, and dynasty are all required.");
        }

        if (
          dynasty &&
          !allowedDynasties.includes(dynasty as (typeof allowedDynasties)[number])
        ) {
          errors.push(
            `"${dynasty}" is not a valid dynasty. Use fire, water, earth, or wind.`,
          );
        }

        return {
          mentorName,
          menteeName,
          dynasty,
          rowNumber,
          errors,
          notices: [],
          uploadState: "pending" as const,
        };
      });

      const menteeRows = new Map<string, Pairing[]>();

      mappedPairings.forEach((pairing) => {
        if (!pairing.menteeName) return;
        const key = pairing.menteeName.toLocaleLowerCase();
        menteeRows.set(key, [...(menteeRows.get(key) ?? []), pairing]);
      });

      menteeRows.forEach((duplicates) => {
        if (duplicates.length < 2) return;

        const rowNumbers = duplicates.map((pairing) => pairing.rowNumber).join(", ");

        duplicates.forEach((pairing) => {
          pairing.errors.push(
            `${pairing.menteeName} appears on rows ${rowNumbers}. Each mentee may appear only once.`,
          );
        });
      });

      setPairings(mappedPairings);
    } catch (caughtError) {
      setUploadError(
        caughtError instanceof Error
          ? caughtError.message
          : "The CSV could not be read.",
      );
    } finally {
      setIsReading(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void selectFile(event.dataTransfer.files[0]);
  };

  const clearFile = () => {
    setSelectedFile(null);
    setPairings([]);
    setUploadError("");
    setUploadSuccessMessage("");
    setUploadSuccessDialog(null);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const invalidPairings = pairings.filter((pairing) => pairing.errors.length > 0);
  const normalizedMemberSearchQuery = memberSearchQuery.trim().toLocaleLowerCase();
  const filteredMembers = members.filter((member) =>
    !normalizedMemberSearchQuery
      ? true
      : member.memberName
          .toLocaleLowerCase()
          .includes(normalizedMemberSearchQuery) ||
        member.memberBig
          .toLocaleLowerCase()
          .includes(normalizedMemberSearchQuery),
  );
  const canUpload =
    pairings.length > 0 &&
    invalidPairings.length === 0 &&
    !isReading &&
    !isUploading;

  const handleUpload = async () => {
    if (!canUpload) return;

    setIsUploading(true);
    setUploadError("");
    setUploadSuccessMessage("");
    setUploadSuccessDialog(null);

    try {
      const response = await fetch(`${apiUrl}/api/pairings/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pairings: pairings.map((pairing) => ({
            mentor_name: pairing.mentorName,
            mentee_name: pairing.menteeName,
            dynasty: pairing.dynasty,
          })),
        }),
      });

      const payload = (await response.json()) as
        | ImportSuccessResponse
        | ApiErrorResponse;

      if (!response.ok) {
        setUploadError(
          "error" in payload && payload.error
            ? payload.error
            : "The upload could not be completed. Please try again.",
        );
        return;
      }

      const successPayload = payload as ImportSuccessResponse;
      const resultsByRow = new Map(
        successPayload.results.map((result) => [result.rowNumber, result]),
      );

      setPairings((currentPairings) =>
        currentPairings.map((pairing) => {
          const result = resultsByRow.get(pairing.rowNumber);

          if (!result) return pairing;

          const notices = result.skipped.map((conflict) => conflict.message);
          const uploadState =
            result.inserted && notices.length > 0
              ? "uploaded-with-skips"
              : result.inserted
                ? "uploaded"
                : "skipped";

          return {
            ...pairing,
            notices,
            uploadState,
          };
        }),
      );

      const successMessage = `${successPayload.insertedCount} ${successPayload.insertedCount === 1 ? "member was" : "members were"} inserted into the database.${successPayload.skippedCount ? ` ${successPayload.skippedCount} ${successPayload.skippedCount === 1 ? "existing person was" : "existing people were"} skipped.` : ""}`;

      setUploadSuccessMessage(successMessage);
      setUploadSuccessDialog({ message: successMessage });
      await loadMembers();
    } catch {
      setUploadError("The upload could not be completed. Please check the API connection.");
    } finally {
      setIsUploading(false);
    }
  };

  const updateMemberField = (
    memberId: string,
    field: "memberName" | "memberBig" | "dynasty" | "isDynastyHead",
    value: string,
  ) => {
    setMembers((currentMembers) =>
      currentMembers.map((member) =>
        member.id === memberId
          ? { ...member, [field]: value, rowError: "" }
          : member,
      ),
    );
    setMembersError("");
    setMembersSuccess("");
  };

  const updateNewMemberField = (
    field: "memberName" | "memberBig" | "dynasty" | "isDynastyHead",
    value: string,
  ) => {
    setNewMemberForm((currentForm) => ({
      ...currentForm,
      [field]: value,
      error: "",
    }));
    setMembersError("");
    setMembersSuccess("");
  };

  const resetNewMemberForm = () => {
    setNewMemberForm({
      memberName: "",
      memberBig: "",
      dynasty: "fire",
      isDynastyHead: "false",
      error: "",
      isSubmitting: false,
    });
  };

  const buildSaveSummary = (memberId: string, createMissingMentor: boolean) => {
    const current = members.find((member) => member.id === memberId);
    const original = memberSnapshots[memberId];

    if (!current || !original) return { summaryLines: [], effectLines: [] };

    const summaryLines: string[] = [];
    const effectLines: string[] = [];

    if (current.memberName.trim() !== original.memberName.trim()) {
      summaryLines.push(
        `Member Name: ${original.memberName || "null"} -> ${current.memberName || "null"}`,
      );
    }

    if (current.memberBig.trim() !== original.memberBig.trim()) {
      summaryLines.push(
        `Member Big: ${original.memberBig || "null"} -> ${current.memberBig || "null"}`,
      );
    }

    if (current.dynasty !== original.dynasty) {
      summaryLines.push(`Dynasty: ${original.dynasty} -> ${current.dynasty}`);
    }

    if (current.isDynastyHead !== original.isDynastyHead) {
      summaryLines.push(
        `Dynasty Head: ${formatBool(original.isDynastyHead)} -> ${formatBool(current.isDynastyHead)}`,
      );
    }

    if (current.memberName.trim() !== original.memberName.trim()) {
      const affectedRows = members.filter(
        (member) =>
          member.id !== memberId &&
          member.memberBig.trim().toLocaleLowerCase() ===
            original.memberName.trim().toLocaleLowerCase(),
      );

      if (affectedRows.length > 0) {
        effectLines.push(
          `${affectedRows.length} ${affectedRows.length === 1 ? "row" : "rows"} will update Member Big from ${original.memberName} to ${current.memberName}.`,
        );
      }
    }

    if (createMissingMentor && current.memberBig.trim()) {
      effectLines.push(
        `${current.memberBig.trim()} does not exist in the database, so a new row for ${current.memberBig.trim()} will also be created.`,
      );
    }

    return {
      summaryLines:
        summaryLines.length > 0 ? summaryLines : ["No visible field changes."],
      effectLines,
    };
  };

  const buildDeleteSummary = (memberId: string) => {
    const current = members.find((member) => member.id === memberId);

    if (!current) return { summaryLines: [], effectLines: [] };

    const summaryLines = [`Delete row for ${current.memberName}.`];
    const effectLines: string[] = [];
    const affectedRows = members.filter(
      (member) =>
        member.id !== memberId &&
        member.memberBig.trim().toLocaleLowerCase() ===
          current.memberName.trim().toLocaleLowerCase(),
    );

    if (affectedRows.length > 0) {
      effectLines.push(
        `${affectedRows.length} ${affectedRows.length === 1 ? "row" : "rows"} will update Member Big from ${current.memberName} to null.`,
      );
    }

    return { summaryLines, effectLines };
  };

  const validateNewMemberForm = () => {
    const trimmedMemberName = newMemberForm.memberName.trim();
    const trimmedMemberBig = newMemberForm.memberBig.trim();

    if (!trimmedMemberName) {
      return "Member name is required.";
    }

    if (
      members.some(
        (member) =>
          member.memberName.trim().toLocaleLowerCase() ===
          trimmedMemberName.toLocaleLowerCase(),
      )
    ) {
      return `${trimmedMemberName} already exists in the database as a member.`;
    }

    if (!allowedDynasties.includes(newMemberForm.dynasty)) {
      return "Dynasty must be fire, water, earth, or wind.";
    }

    if (
      trimmedMemberBig &&
      trimmedMemberBig.toLocaleLowerCase() === trimmedMemberName.toLocaleLowerCase()
    ) {
      return "A member cannot list themself as their own mentor.";
    }

    return "";
  };

  const createMember = async (createMissingMentor: boolean) => {
    const trimmedMemberName = newMemberForm.memberName.trim();
    const trimmedMemberBig = newMemberForm.memberBig.trim();

    setNewMemberForm((currentForm) => ({
      ...currentForm,
      isSubmitting: true,
      error: "",
    }));
    setMembersError("");
    setMembersSuccess("");

    try {
      const response = await fetch(`${apiUrl}/api/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          member_name: trimmedMemberName,
          member_big: trimmedMemberBig || null,
          dynasty: newMemberForm.dynasty,
          is_dynasty_head: newMemberForm.isDynastyHead === "true",
          create_missing_mentor: createMissingMentor,
        }),
      });

      const payload = (await response.json()) as
        | MemberResponse
        | (ApiErrorResponse & {
            requiresMentorConfirmation?: boolean;
            missingMentorName?: string;
          });

      if (!response.ok) {
        if (
          response.status === 409 &&
          "requiresMentorConfirmation" in payload &&
          payload.requiresMentorConfirmation &&
          payload.missingMentorName
        ) {
          setConfirmDialog({
            type: "create-missing-mentor",
            mentorName: payload.missingMentorName,
            summaryLines: [
              `Member Name: ${trimmedMemberName}`,
              `Member Big: ${trimmedMemberBig || "null"}`,
              `Dynasty: ${newMemberForm.dynasty}`,
              `Dynasty Head: ${formatBool(newMemberForm.isDynastyHead)}`,
            ],
            effectLines: [
              `${payload.missingMentorName} does not exist in the database, so a new row for ${payload.missingMentorName} will also be created.`,
            ],
          });
          return;
        }

        const formError =
          "error" in payload && payload.error
            ? payload.error
            : "The member could not be created.";

        setNewMemberForm((currentForm) => ({
          ...currentForm,
          error: formError,
        }));
        setMembersError(formError);
        return;
      }

      const successPayload = payload as MemberResponse;
      const successMessage = successPayload.createdMentor
        ? `${successPayload.member.member_name} was added. ${successPayload.createdMentor.member_name} was also created as a mentor.`
        : `${successPayload.member.member_name} was added.`;

      resetNewMemberForm();
      setMembersSuccess(successMessage);
      await loadMembers();
    } catch {
      const formError =
        "The member could not be created. Please check the API connection.";
      setNewMemberForm((currentForm) => ({
        ...currentForm,
        error: formError,
      }));
      setMembersError(formError);
    } finally {
      setNewMemberForm((currentForm) => ({
        ...currentForm,
        isSubmitting: false,
      }));
    }
  };

  const saveMember = async (memberId: string, createMissingMentor = false) => {
    const target = members.find((member) => member.id === memberId);

    if (!target) return;

    const trimmedMemberName = target.memberName.trim();
    const trimmedMemberBig = target.memberBig.trim();

    let rowError = "";

    if (!trimmedMemberName) {
      rowError = "Member name is required.";
    } else if (!allowedDynasties.includes(target.dynasty)) {
      rowError = "Dynasty must be fire, water, earth, or wind.";
    } else if (
      trimmedMemberBig &&
      trimmedMemberBig.toLocaleLowerCase() === trimmedMemberName.toLocaleLowerCase()
    ) {
      rowError = "A member cannot list themself as their own mentor.";
    }

    if (rowError) {
      setMembers((currentMembers) =>
        currentMembers.map((member) =>
          member.id === memberId ? { ...member, rowError } : member,
        ),
      );
      setMembersError(rowError);
      return;
    }

    setMembersError("");
    setMembersSuccess("");
    setMembers((currentMembers) =>
      currentMembers.map((member) =>
        member.id === memberId
          ? { ...member, isSaving: true, rowError: "" }
          : member,
      ),
    );

    try {
      const response = await fetch(`${apiUrl}/api/members/${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          member_name: target.memberName.trim(),
          member_big: target.memberBig.trim() || null,
          dynasty: target.dynasty,
          is_dynasty_head: target.isDynastyHead === "true",
          create_missing_mentor: createMissingMentor,
        }),
      });

      const payload = (await response.json()) as
        | MemberResponse
        | (ApiErrorResponse & {
            requiresMentorConfirmation?: boolean;
            missingMentorName?: string;
          });

      if (!response.ok) {
        if (
          response.status === 409 &&
          "requiresMentorConfirmation" in payload &&
          payload.requiresMentorConfirmation &&
          payload.missingMentorName
        ) {
          const { summaryLines, effectLines } = buildSaveSummary(memberId, true);
          setConfirmDialog({
            type: "save",
            memberId,
            createMissingMentor: true,
            summaryLines,
            effectLines,
          });
          return;
        }

        const rowError =
          "error" in payload && payload.error
            ? payload.error
            : "The member could not be updated.";

        setMembers((currentMembers) =>
          currentMembers.map((member) =>
            member.id === memberId ? { ...member, rowError } : member,
          ),
        );
        setMembersError(rowError);
        return;
      }

      const updatedMember = (payload as MemberResponse).member;
      setMembers((currentMembers) =>
        currentMembers.map((member) =>
          member.id === memberId
            ? { ...toEditableMember(updatedMember), isSaving: false, isDeleting: false }
            : member,
        ),
      );
      setMembersSuccess(`Saved changes for ${updatedMember.member_name}.`);
      await loadMembers();
    } catch {
      setMembersError("The member could not be updated. Please check the API connection.");
    } finally {
      setMembers((currentMembers) =>
        currentMembers.map((member) =>
          member.id === memberId ? { ...member, isSaving: false } : member,
        ),
      );
    }
  };

  const deleteMember = async (memberId: string) => {
    setMembersError("");
    setMembersSuccess("");
    setMembers((currentMembers) =>
      currentMembers.map((member) =>
        member.id === memberId ? { ...member, isDeleting: true } : member,
      ),
    );

    try {
      const response = await fetch(`${apiUrl}/api/members/${memberId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorResponse;
        setMembersError(payload.error ?? "The member could not be deleted.");
        return;
      }

      setMembers((currentMembers) =>
        currentMembers.filter((member) => member.id !== memberId),
      );
      setMembersSuccess("The row was deleted.");
      await loadMembers();
    } catch {
      setMembersError("The member could not be deleted. Please check the API connection.");
    }
  };

  const confirmAction = async () => {
    if (!confirmDialog) return;

    const currentDialog = confirmDialog;
    setConfirmDialog(null);

    if (currentDialog.type === "save") {
      await saveMember(
        currentDialog.memberId,
        currentDialog.createMissingMentor,
      );
      return;
    }

    if (currentDialog.type === "create-missing-mentor") {
      await createMember(true);
      return;
    }

    await deleteMember(currentDialog.memberId);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="CSA Family Tree CMS home">
          <span>CSA Family Tree Content Management System</span>
        </a>
      </header>

      <main className="layout-shell">
        <div className="page-heading">
          <h1>Manage family tree records</h1>
          <p className="intro">
            Edit individual member data or bulk upload mentor-mentee pairings.
          </p>
        </div>

        <nav className="tab-nav" aria-label="CMS sections">
          <button
            className={`tab-button ${activeTab === "members" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveTab("members")}
          >
            Edit Members
          </button>
          <button
            className={`tab-button ${activeTab === "bulk-upload" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveTab("bulk-upload")}
          >
            Bulk Upload
          </button>
        </nav>

        {activeTab === "members" ? (
          <section className="preview-card" aria-labelledby="members-heading">
            <div className="preview-heading">
              <div>
                <p className="eyebrow">Database editor</p>
                <h2 id="members-heading">Edit all member data</h2>
              </div>
              <button className="choose-button" type="button" onClick={() => void loadMembers()}>
                Refresh
              </button>
            </div>

            <div className="rules-callout" role="note" aria-label="Editing rules">
              <strong>Editing rules</strong>
              <ul>
                <li><span className="inline-code-label">Member Name</span> is required and must be unique.</li>
                <li><span className="inline-code-label">Member Big</span> is optional, but if you set it, that mentor must already exist.</li>
                <li>A member cannot list themself as their own mentor.</li>
                <li><span className="inline-code-label">Dynasty</span> must be <span className="inline-code-label">fire</span>, <span className="inline-code-label">water</span>, <span className="inline-code-label">earth</span>, or <span className="inline-code-label">wind</span>.</li>
                <li>When you rename a member, any mentees linked to that member are updated automatically.</li>
                <li>When you delete a mentor, affected <span className="inline-code-label">Member Big</span> values are cleared to <span className="inline-code-label">null</span> automatically.</li>
                <li>Adding a member with a missing mentor will prompt you to confirm creating that mentor too.</li>
              </ul>
            </div>

            {membersError && (
              <p className="error-message panel-message" role="alert">
                {membersError}
              </p>
            )}

            {membersSuccess && (
              <p className="success-message panel-message" role="status">
                {membersSuccess}
              </p>
            )}

            <div className="add-member-panel">
              <div className="panel-heading-row">
                <div>
                  <p className="eyebrow">Manual entry</p>
                  <h3>Add new member</h3>
                </div>
              </div>

              <div className="add-member-grid">
                <label className="field-group">
                  <span>Member name</span>
                  <input
                    className="cell-input"
                    type="text"
                    value={newMemberForm.memberName}
                    onChange={(event) =>
                      updateNewMemberField("memberName", event.target.value)
                    }
                  />
                </label>

                <label className="field-group">
                  <span>Member big</span>
                  <input
                    className="cell-input"
                    type="text"
                    placeholder="No mentor"
                    value={newMemberForm.memberBig}
                    onChange={(event) =>
                      updateNewMemberField("memberBig", event.target.value)
                    }
                  />
                </label>

                <label className="field-group">
                  <span>Dynasty</span>
                  <select
                    className="cell-select"
                    value={newMemberForm.dynasty}
                    onChange={(event) =>
                      updateNewMemberField("dynasty", event.target.value)
                    }
                  >
                    {allowedDynasties.map((dynasty) => (
                      <option key={dynasty} value={dynasty}>
                        {dynasty}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-group">
                  <span>Dynasty head</span>
                  <select
                    className="cell-select"
                    value={newMemberForm.isDynastyHead}
                    onChange={(event) =>
                      updateNewMemberField("isDynastyHead", event.target.value)
                    }
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </label>

                <div className="field-group field-action">
                  <span>&nbsp;</span>
                  <button
                    className="continue-button add-member-button"
                    type="button"
                    disabled={newMemberForm.isSubmitting}
                    onClick={() => {
                      const formError = validateNewMemberForm();

                      if (formError) {
                        setNewMemberForm((currentForm) => ({
                          ...currentForm,
                          error: formError,
                        }));
                        setMembersError(formError);
                        return;
                      }

                      void createMember(false);
                    }}
                  >
                    {newMemberForm.isSubmitting ? "Adding…" : "Add"}
                  </button>
                </div>
              </div>

              {newMemberForm.error && (
                <p className="error-message inline-error" role="alert">
                  {newMemberForm.error}
                </p>
              )}
            </div>

            {isMembersLoading ? (
              <div className="empty-state">Loading member records…</div>
            ) : members.length === 0 ? (
              <div className="empty-state">No member rows were found in the database.</div>
            ) : (
              <>
                <div className="search-row">
                  <label className="search-field">
                    <span>Search members by name</span>
                    <input
                      className="cell-input"
                      type="search"
                      placeholder="Start typing a member name"
                      value={memberSearchQuery}
                      onChange={(event) => setMemberSearchQuery(event.target.value)}
                    />
                  </label>
                </div>

                {filteredMembers.length === 0 ? (
                  <div className="empty-state">No members match that search.</div>
                ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Member Name</th>
                      <th scope="col">Member Big</th>
                      <th scope="col">Dynasty</th>
                      <th scope="col">Dynasty Head</th>
                      <th scope="col">Save</th>
                      <th scope="col">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <input
                            className="cell-input"
                            type="text"
                            value={member.memberName}
                            onChange={(event) =>
                              updateMemberField(member.id, "memberName", event.target.value)
                            }
                          />
                          {member.rowError && <p className="row-error">{member.rowError}</p>}
                        </td>
                        <td>
                          <input
                            className="cell-input"
                            type="text"
                            value={member.memberBig}
                            placeholder="No mentor"
                            onChange={(event) =>
                              updateMemberField(member.id, "memberBig", event.target.value)
                            }
                          />
                        </td>
                        <td>
                          <select
                            className="cell-select"
                            value={member.dynasty}
                            onChange={(event) =>
                              updateMemberField(member.id, "dynasty", event.target.value)
                            }
                          >
                            {allowedDynasties.map((dynasty) => (
                              <option key={dynasty} value={dynasty}>
                                {dynasty}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="cell-select"
                            value={member.isDynastyHead}
                            onChange={(event) =>
                              updateMemberField(
                                member.id,
                                "isDynastyHead",
                                event.target.value,
                              )
                            }
                          >
                            <option value="false">No</option>
                            <option value="true">Yes</option>
                          </select>
                        </td>
                        <td>
                          <button
                            className="row-action"
                            type="button"
                            disabled={member.isSaving || member.isDeleting}
                            onClick={() =>
                              setConfirmDialog({
                                type: "save",
                                memberId: member.id,
                                createMissingMentor:
                                  member.memberBig.trim().length > 0 &&
                                  !members.some(
                                    (currentMember) =>
                                      currentMember.id !== member.id &&
                                      currentMember.memberName
                                        .trim()
                                        .toLocaleLowerCase() ===
                                        member.memberBig.trim().toLocaleLowerCase(),
                                  ),
                                ...buildSaveSummary(
                                  member.id,
                                  member.memberBig.trim().length > 0 &&
                                    !members.some(
                                      (currentMember) =>
                                        currentMember.id !== member.id &&
                                        currentMember.memberName
                                          .trim()
                                          .toLocaleLowerCase() ===
                                          member.memberBig.trim().toLocaleLowerCase(),
                                    ),
                                ),
                              })
                            }
                          >
                            {member.isSaving ? "Saving…" : "Save"}
                          </button>
                        </td>
                        <td>
                          <button
                            className="row-action row-action-danger"
                            type="button"
                            disabled={member.isSaving || member.isDeleting}
                            onClick={() =>
                              setConfirmDialog({
                                type: "delete",
                                memberId: member.id,
                                memberName: member.memberName,
                                ...buildDeleteSummary(member.id),
                              })
                            }
                          >
                            {member.isDeleting ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                )}
              </>
            )}
          </section>
        ) : (
          <>
            <section className="upload-card" aria-labelledby="upload-heading">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Bulk upload</p>
                  <h2 id="upload-heading">Upload mentor pairings</h2>
                </div>
                <span className="file-type">CSV</span>
              </div>

              {selectedFile ? (
                <div className="selected-file" aria-live="polite">
                  <div className="file-icon" aria-hidden="true">
                    <span>CSV</span>
                  </div>
                  <div className="file-details">
                    <strong>{selectedFile.name}</strong>
                    <span>{formatFileSize(selectedFile.size)}</span>
                  </div>
                  <button className="remove-button" type="button" onClick={clearFile}>
                    Remove
                  </button>
                </div>
              ) : (
                <div
                  className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <div className="upload-icon" aria-hidden="true">
                    ↑
                  </div>
                  <strong>Drag and drop your CSV here</strong>
                  <span>or</span>
                  <button
                    className="choose-button"
                    type="button"
                    onClick={() => inputRef.current?.click()}
                  >
                    Choose file
                  </button>
                  <input
                    ref={inputRef}
                    className="visually-hidden"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => void selectFile(event.target.files?.[0])}
                  />
                </div>
              )}

              {uploadError && (
                <p className="error-message" role="alert">
                  {uploadError}
                </p>
              )}

              <div className="format-guide">
                <h3>Required format</h3>
                <p>
                  The first row of your file must contain these column headers in
                  this order:
                </p>
                <div className="column-list" aria-label="Required CSV columns">
                  {expectedColumns.map((column, index) => (
                    <span key={column}>
                      <b>{index + 1}</b>
                      <code>{column}</code>
                    </span>
                  ))}
                </div>
                <p className="relationship-note">
                  Dynasties must be <code>fire</code>, <code>water</code>,{" "}
                  <code>earth</code>, or <code>wind</code>. A mentor may appear in
                  multiple rows. Each mentee should appear only once.
                </p>
              </div>

              <div className="card-footer">
                <p>
                  {isReading
                    ? "Reading your file…"
                    : isUploading
                      ? "Uploading your pairings…"
                      : pairings.length
                        ? invalidPairings.length
                          ? `${invalidPairings.length} ${invalidPairings.length === 1 ? "row needs" : "rows need"} attention before upload.`
                          : `${pairings.length} valid ${pairings.length === 1 ? "pairing" : "pairings"} ready to upload.`
                        : "Select a file to preview its contents."}
                </p>
                <button
                  className="continue-button"
                  type="button"
                  disabled={!canUpload}
                  onClick={() => void handleUpload()}
                >
                  {isUploading ? "Uploading…" : "Upload pairings"}
                </button>
              </div>
            </section>

            {pairings.length > 0 && (
              <section className="preview-card" aria-labelledby="preview-heading">
                <div className="preview-heading">
                  <div>
                    <p className="eyebrow">File preview</p>
                    <h2 id="preview-heading">Review your pairings</h2>
                  </div>
                  <span className="row-count">
                    {invalidPairings.length
                      ? `${invalidPairings.length} invalid`
                      : `${pairings.length} ${pairings.length === 1 ? "row" : "rows"}`}
                  </span>
                </div>

                {invalidPairings.length > 0 && (
                  <div className="validation-summary" role="alert">
                    <strong>Some rows need attention</strong>
                    <span>
                      Fix the highlighted rows in your CSV, then upload the file
                      again.
                    </span>
                  </div>
                )}

                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Mentor</th>
                        <th scope="col">Mentee</th>
                        <th scope="col">Dynasty</th>
                        <th scope="col">Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairings.map((pairing, index) => (
                        <tr
                          key={`${pairing.menteeName}-${pairing.mentorName}-${index}`}
                          className={
                            pairing.errors.length
                              ? "invalid-row"
                              : pairing.uploadState === "uploaded-with-skips" ||
                                  pairing.uploadState === "skipped"
                                ? "skipped-row"
                                : ""
                          }
                        >
                          <td>{pairing.mentorName}</td>
                          <td>{pairing.menteeName}</td>
                          <td>
                            <span className="dynasty-pill">{pairing.dynasty}</span>
                          </td>
                          <td className="validation-cell">
                            {pairing.errors.length ? (
                              <ul>
                                {pairing.errors.map((rowError) => (
                                  <li key={rowError}>{rowError}</li>
                                ))}
                              </ul>
                            ) : pairing.notices.length ? (
                              <ul className="notice-list">
                                {pairing.notices.map((notice) => (
                                  <li key={notice}>{notice}</li>
                                ))}
                              </ul>
                            ) : pairing.uploadState === "uploaded" ? (
                              <span className="uploaded-label">Uploaded</span>
                            ) : (
                              <span className="valid-label">Valid</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {confirmDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true">
            <h2>
              {confirmDialog.type === "save"
                ? "Confirm save"
                : confirmDialog.type === "create-missing-mentor"
                  ? "Confirm add"
                  : "Confirm delete"}
            </h2>
            <p>
              {confirmDialog.type === "save"
                ? "Review the changes that will be saved:"
                : confirmDialog.type === "create-missing-mentor"
                  ? `${confirmDialog.mentorName} does not exist yet. Review the new rows that will be created:`
                : `Review the changes that will happen when ${confirmDialog.memberName} is deleted:`}
            </p>
            {"summaryLines" in confirmDialog && confirmDialog.summaryLines.length > 0 && (
              <ul className="dialog-summary">
                {confirmDialog.summaryLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {"effectLines" in confirmDialog && confirmDialog.effectLines.length > 0 && (
              <div className="dialog-effects">
                {confirmDialog.effectLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
            <div className="dialog-actions">
              <button
                className="choose-button"
                type="button"
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </button>
              <button className="continue-button" type="button" onClick={() => void confirmAction()}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadSuccessDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true">
            <h2>Upload complete</h2>
            <p>{uploadSuccessDialog.message}</p>
            <div className="dialog-actions">
              <button
                className="continue-button"
                type="button"
                onClick={() => setUploadSuccessDialog(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
