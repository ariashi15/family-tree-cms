import { useRef, useState } from "react";
import type { DragEvent } from "react";

const expectedColumns = ["mentor_name", "mentee_name", "dynasty"];

type Pairing = {
  mentorName: string;
  menteeName: string;
  dynasty: string;
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

  const selectFile = async (file?: File) => {
    setError("");
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

      const seenMentees = new Map<string, number>();
      const mappedPairings = parsedRows.slice(1).map((row, index) => {
        const lineNumber = index + 2;

        if (row.length !== expectedColumns.length) {
          throw new Error(
            `Row ${lineNumber} has ${row.length} columns; expected 3.`,
          );
        }

        const [mentorName, menteeName, dynasty] = row;

        if (!mentorName || !menteeName || !dynasty) {
          throw new Error(`Row ${lineNumber} contains an empty required value.`);
        }

        const menteeKey = menteeName.toLocaleLowerCase();
        const previousLine = seenMentees.get(menteeKey);

        if (previousLine) {
          throw new Error(
            `${menteeName} appears as a mentee on rows ${previousLine} and ${lineNumber}. Each mentee may appear only once.`,
          );
        }

        seenMentees.set(menteeKey, lineNumber);

        return { mentorName, menteeName, dynasty };
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

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Family Tree CMS home">
          <span className="brand-mark" aria-hidden="true">
            FT
          </span>
          <span>Family Tree CMS</span>
        </a>
      </header>

      <main>
        <div className="page-heading">
          <p className="eyebrow">Pairing management</p>
          <h1>Upload mentor pairings</h1>
          <p className="intro">
            Add mentor and mentee relationships to the family tree from a CSV
            file.
          </p>
        </div>

        <section className="upload-card" aria-labelledby="upload-heading">
          <div className="card-heading">
            <div>
              <p className="step">Step 1 of 1</p>
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
              A mentor may appear in multiple rows. Each mentee should appear
              only once.
            </p>
          </div>

          <div className="card-footer">
            <p>
              {isReading
                ? "Reading your file…"
                : pairings.length
                  ? `${pairings.length} valid ${pairings.length === 1 ? "pairing" : "pairings"} ready to upload.`
                  : "Select a file to preview its contents."}
            </p>
            <button className="continue-button" type="button" disabled>
              Upload pairings
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
                {pairings.length} {pairings.length === 1 ? "row" : "rows"}
              </span>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Mentor</th>
                    <th scope="col">Mentee</th>
                    <th scope="col">Dynasty</th>
                  </tr>
                </thead>
                <tbody>
                  {pairings.map((pairing, index) => (
                    <tr
                      key={`${pairing.menteeName}-${pairing.mentorName}-${index}`}
                    >
                      <td>{pairing.mentorName}</td>
                      <td>{pairing.menteeName}</td>
                      <td>
                        <span className="dynasty-pill">{pairing.dynasty}</span>
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
