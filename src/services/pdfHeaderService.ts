import { CLINIC_LOGO_PNG_BASE64, NABH_MARK_PNG_BASE64 } from "./clinicAssets";

export const CLINIC = {
  name: "Royal Dental",
  subtitle: "SUPERSPECIALITY CLINIC",
  fullName: "Royal Dental Superspeciality Clinic",
  address: "2965, Sector 46, Near Amity Global School, Gurugram, Haryana",
  doctors: [
    {
      name: "Dr. Kunal Agnihotri",
      lines: [
        "BDS, MDS (Endodontist)",
        "Certified Implantologist",
        "Oral Surgery-STC (AMU)",
        "Regd. No. A-14704",
      ],
    },
    {
      name: "Dr. Ridhi Agnihotri",
      lines: [
        "BDS, MDS (Endodontist)",
        "Certified Smile Design Specialist",
        "Regd. No. A-8551",
      ],
    },
  ],
};

export const COLORS = {
  navy: "#2F4B7C",
  band: "#DCE6F2",
  maroon: "#8B2A3A",
  text: "#222222",
  muted: "#666666",
  rule: "#C9D3E0",
  zebra: "#F3F6FA",
};

const logo = Buffer.from(CLINIC_LOGO_PNG_BASE64, "base64");
const nabh = Buffer.from(NABH_MARK_PNG_BASE64, "base64");

// Source crops are 154x204 (tooth) and 124x134 (NABH); keep aspect ratios.
const LOGO_W = 40;
const LOGO_H = LOGO_W * (204 / 154);
const NABH_W = 52;
const NABH_H = NABH_W * (134 / 124);

/**
 * Draws the clinic letterhead at the current page's top margin and returns the
 * y coordinate immediately below it. Recreated from the clinic's letterhead
 * (logo + NABH mark are crops of the supplied letterhead photo, not redrawn).
 */
export const drawLetterhead = (doc: PDFKit.PDFDocument): number => {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const top = doc.page.margins.top;

  doc.image(logo, left, top, { width: LOGO_W, height: LOGO_H });
  doc.image(nabh, left + width - NABH_W, top, { width: NABH_W, height: NABH_H });

  const textX = left + LOGO_W + 10;
  const textW = width - LOGO_W - NABH_W - 20;
  doc
    .font("Times-BoldItalic")
    .fontSize(30)
    .fillColor(COLORS.navy)
    .text(CLINIC.name, textX, top + 2, { width: textW, align: "center", lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(COLORS.maroon)
    .text(CLINIC.subtitle, textX, top + 40, {
      width: textW,
      align: "center",
      characterSpacing: 1,
      lineBreak: false,
    });
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(COLORS.muted)
    .text("D-2021-0167", left + width - NABH_W, top + NABH_H + 2, {
      width: NABH_W,
      align: "center",
      lineBreak: false,
    });

  let y = top + Math.max(LOGO_H, NABH_H + 10) + 8;

  doc.rect(left, y, width, 2.5).fill(COLORS.navy);
  y += 2.5;
  doc.rect(left, y, width, 20).fill(COLORS.band);
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(COLORS.text)
    .text(CLINIC.address.toUpperCase(), left, y + 6, {
      width,
      align: "center",
      lineBreak: false,
    });
  y += 20;

  const colW = width / 2;
  let tallest = 0;
  CLINIC.doctors.forEach((doctor, i) => {
    const x = left + i * colW + 8;
    let cy = y + 8;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.maroon).text(doctor.name, x, cy, {
      width: colW - 16,
      lineBreak: false,
    });
    cy += 13;
    doc.font("Helvetica").fontSize(8).fillColor(COLORS.text);
    for (const line of doctor.lines) {
      doc.text(line, x, cy, { width: colW - 16, lineBreak: false });
      cy += 11;
    }
    tallest = Math.max(tallest, cy - y);
  });
  y += tallest + 6;

  doc.rect(left, y, width, 2).fill(COLORS.navy);
  return y + 2;
};
