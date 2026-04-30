const fs = require("fs");
const path = require("path");

const outputPath = path.join(__dirname, "..", "docs", "Organizer-Fixtures-Guide.pdf");

const sections = [
  {
    title: "Organizer Fixtures Guide",
    intro: [
      "This guide explains, in a simple human way, how organizers should use the Manage Matches dashboard to create fixtures, update final scores, postpone games, cancel matches, and keep the tournament website accurate.",
      "Core idea: create a fixture once, then update the same match later by using the same Match ID."
    ]
  },
  {
    title: "What Every Field Means",
    bullets: [
      "Match ID: a unique number for one match. Reuse it later when updating that same match.",
      "Status: scheduled before kickoff, played after full time, postponed if delayed, cancelled if removed.",
      "Match Date: the day the game should happen.",
      "Match Time: the kickoff time.",
      "Home Team Number: the team number of the home side.",
      "Away Team Number: the team number of the away side.",
      "Referee ID: optional if you manage referees in the system.",
      "Home Goals and Away Goals: keep them at 0 before the game is played, then update them with the final result."
    ]
  },
  {
    title: "How To Create A New Fixture",
    bullets: [
      "Open Manage Matches in the Organizer Control Panel.",
      "Choose a new Match ID that is not already used.",
      "Set Status to scheduled.",
      "Enter the Match Date and Match Time.",
      "Enter the Home Team Number and Away Team Number.",
      "Leave Home Goals and Away Goals at 0 before kickoff.",
      "Click Save Match."
    ],
    example: [
      "Example fixture:",
      "Match ID: 1001",
      "Status: scheduled",
      "Match Date: 2026-04-02",
      "Match Time: 18:00",
      "Home Team Number: 3",
      "Away Team Number: 5",
      "Home Goals: 0",
      "Away Goals: 0"
    ]
  },
  {
    title: "How To Update A Played Match",
    bullets: [
      "Use the same Match ID as the original fixture.",
      "Change Status to played.",
      "Enter the final Home Goals.",
      "Enter the final Away Goals.",
      "Click Save Match again.",
      "This updates the fixture and affects the League Table."
    ],
    example: [
      "Example result update:",
      "Match ID: 1001",
      "Status: played",
      "Home Goals: 2",
      "Away Goals: 1"
    ]
  },
  {
    title: "Special Cases",
    bullets: [
      "Postponed: use the same Match ID and set Status to postponed.",
      "Cancelled: use the same Match ID and set Status to cancelled.",
      "Delete Match: if the record itself is wrong, use Delete Match ID and click Delete Match."
    ]
  },
  {
    title: "After Saving A Played Match",
    bullets: [
      "Open Manage Player Stats and add the goals, assists, yellow cards, red cards, and clean sheets for the players involved.",
      "Refresh the dashboard and check Fixtures, League Table, Top Scorers, Top Assists, and Clean Sheets.",
      "If something looks wrong, verify the team number, jersey number, and match ID first."
    ]
  },
  {
    title: "Common Mistakes To Avoid",
    bullets: [
      "Do not create a second match if the fixture already exists. Update the first one instead.",
      "Do not use the wrong team number. A wrong number attaches the fixture to the wrong club.",
      "Do not forget to change Status to played after full time, otherwise the table will not update.",
      "Do not enter player stats before the match exists in Manage Matches."
    ]
  },
  {
    title: "Simple Matchday Routine",
    bullets: [
      "Before kickoff: create the fixture and make sure it is marked as scheduled.",
      "After full time: update the same match to played, enter the final score, then add player stats.",
      "End of day: review the dashboard and confirm the highlights and league table match the real games."
    ]
  }
];

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function createPages() {
  const pages = [];
  let currentPage = [];
  let y = 752;

  const startNewPage = () => {
    if (currentPage.length) {
      pages.push(currentPage);
    }
    currentPage = [];
    y = 752;
  };

  const ensureSpace = (needed = 26) => {
    if (y - needed < 56) {
      startNewPage();
    }
  };

  const addTextLine = (text, fontSize = 12, color = "0.66 0.69 0.76", x = 54) => {
    ensureSpace(fontSize + 10);
    currentPage.push({
      text,
      x,
      y,
      fontSize,
      color
    });
    y -= fontSize + 7;
  };

  const addWrappedText = (text, fontSize = 12, color = "0.66 0.69 0.76", maxChars = 92, bullet = false) => {
    const prefix = bullet ? "- " : "";
    const lines = wrapLine(`${prefix}${text}`, maxChars);
    for (const line of lines) {
      addTextLine(line, fontSize, color);
    }
  };

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];

    if (index > 0) {
      y -= 10;
    }

    ensureSpace(48);
    addTextLine(section.title, index === 0 ? 26 : 18, index === 0 ? "0.90 0.93 0.97" : "0.62 0.83 1.00");

    if (section.intro) {
      for (const paragraph of section.intro) {
        addWrappedText(paragraph, 12.5, "0.82 0.86 0.91", 94, false);
        y -= 4;
      }
    }

    if (section.bullets) {
      for (const bullet of section.bullets) {
        addWrappedText(bullet, 12, "0.72 0.76 0.82", 90, true);
        y -= 2;
      }
    }

    if (section.example) {
      y -= 4;
      addTextLine("Example", 14, "0.98 0.87 0.57");
      for (const line of section.example) {
        addWrappedText(line, 11.5, "0.88 0.91 0.95", 90, false);
      }
    }
  }

  if (currentPage.length) {
    pages.push(currentPage);
  }

  return pages;
}

function buildContentStream(lines) {
  return lines.map((line) => (
    `BT
/F1 ${line.fontSize} Tf
${line.color} rg
1 0 0 1 ${line.x} ${line.y} Tm
(${escapePdfText(line.text)}) Tj
ET
`
  )).join("");
}

function buildPdf() {
  const pages = createPages();
  const objects = [];

  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesRootId = addObject("__PAGES_PLACEHOLDER__");
  const pageIds = [];

  for (const page of pages) {
    const contentStream = buildContentStream(page);
    const contentId = addObject(
      `<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}endstream`
    );
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[pagesRootId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}

function generatePdf() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buildPdf(), "binary");
}

generatePdf();
console.log(outputPath);
