import { useRef, useState } from "react";
import type { DragEvent } from "react";

const expectedColumns = ["mentor_name", "mentee_name", "dynasty"];
const allowedDynasties = new Set(["fire", "water", "earth", "wind"]);
const apiUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type Pairing = {
  mentorName: string;
  menteeName: string;
  dynasty: string;
  rowNumber: number;
  errors: string[];
  notices: string[];
  uploadState: "pending" | "uploaded" | "uploaded-with-skips" | "skipped";
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

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const selectFile = async (file?: File) => {
    setError("");
    setSuccessMessage("");
    setPairings([]);

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setSelectedFile(null);
      setError("Choose a CSV file with a .csv extension.");
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

        if (row.length !== expectedColumns.length) {
          errors.push(
            `This row has ${row.length} columns; exactly 3 are required.`,
          );
        }

        const [mentorName = "", menteeName = "", dynasty = ""] = row;

        if (!mentorName || !menteeName || !dynasty) {
          errors.push("Mentor, mentee, and dynasty are all required.");
        }

        if (dynasty && !allowedDynasties.has(dynasty)) {
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

        const rowNumbers = duplicates
          .map((pairing) => pairing.rowNumber)
          .join(", ");

        duplicates.forEach((pairing) => {
          pairing.errors.push(
            `${pairing.menteeName} appears on rows ${rowNumbers}. Each mentee may appear only once.`,
          );
        });
      });

      setPairings(mappedPairings);
    } catch (caughtError) {
      setError(
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
    selectFile(event.dataTransfer.files[0]);
  };

  const clearFile = () => {
    setSelectedFile(null);
    setPairings([]);
    setError("");
    setSuccessMessage("");

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleUpload = async () => {
    if (!canUpload) return;

    setIsUploading(true);
    setError("");
    setSuccessMessage("");

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
        setError(
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

          if (!result) {
            return pairing;
          }

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

      setSuccessMessage(
        `${successPayload.insertedCount} ${successPayload.insertedCount === 1 ? "member was" : "members were"} inserted into the database.${successPayload.skippedCount ? ` ${successPayload.skippedCount} ${successPayload.skippedCount === 1 ? "existing person was" : "existing people were"} skipped.` : ""}`,
      );
    } catch {
      setError("The upload could not be completed. Please check the API connection.");
    } finally {
      setIsUploading(false);
    }
  };

  const invalidPairings = pairings.filter(
    (pairing) => pairing.errors.length > 0,
  );
  const canUpload =
    pairings.length > 0 &&
    invalidPairings.length === 0 &&
    !isReading &&
    !isUploading;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Family Tree CMS home">
          <span>CSA Family Tree Content Management System</span>
        </a>
      </header>

      <main>
        <div className="page-heading">
          <h1>Upload mentor pairings</h1>
          <p className="intro">
            Add mentor and mentee relationships to the family trees from a CSV
            file.
          </p>
        </div>

        <section className="upload-card" aria-labelledby="upload-heading">
          <div className="card-heading">
            <div>
              <h2 id="upload-heading">Choose your CSV file</h2>
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
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
            </div>
          )}

          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}

          {successMessage && (
            <p className="success-message" role="status">
              {successMessage}
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
              onClick={handleUpload}
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
      </main>
    </div>
  );
}

export default App;
