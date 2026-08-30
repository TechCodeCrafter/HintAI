export type FixtureItem = {
  str: string;
  x: number;
  y: number;
  size?: number;
};

export type FixturePage = {
  width?: number;
  height?: number;
  items: FixtureItem[];
};

export type FixtureOutline = {
  title: string;
  page: number;
  children?: FixtureOutline[];
};

export function buildPdfBytes(spec: { pages: FixturePage[]; outline?: FixtureOutline[] }): Uint8Array {
  const pages = spec.pages.length === 0 ? [{ items: [] as FixtureItem[] }] : spec.pages;
  const objects: string[] = [];
  const pageObj = (i: number) => 4 + i * 2;
  const contentObj = (i: number) => 5 + i * 2;
  const fontObj = 3;
  const pagesObj = 2;
  const catalogObj = 1;

  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ");
  objects[catalogObj - 1] = "";
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[fontObj - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const width = page.width ?? 612;
    const height = page.height ?? 792;
    const stream = pageContent(page.items);
    objects[pageObj(i) - 1] =
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentObj(i)} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`;
    objects[contentObj(i) - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  let outlineFirst: number | undefined;
  if (spec.outline && spec.outline.length > 0) {
    const built = buildOutlineObjects(spec.outline, objects.length + 1, (page) => `${pageObj(page - 1)} 0 R`);
    outlineFirst = built.root;
    objects.push(...built.objects);
  }

  objects[catalogObj - 1] = outlineFirst
    ? `<< /Type /Catalog /Pages ${pagesObj} 0 R /Outlines ${outlineFirst} 0 R >>`
    : `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;

  return assemble(objects);
}

export function encryptedPdfBytes(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    "<< /Filter /Standard /V 2 /R 3 /Length 128 /O <1111111111111111111111111111111111111111111111111111111111111111> /U <2222222222222222222222222222222222222222222222222222222222222222> /P -4 >>",
  ];
  return assemble(objects, "4 0 R");
}

function pageContent(items: FixtureItem[]): string {
  const ops = ["BT"];
  for (const item of items) {
    const size = item.size ?? 12;
    ops.push(`/F1 ${size} Tf`);
    ops.push(`1 0 0 1 ${item.x} ${item.y} Tm`);
    ops.push(`(${escapePdf(item.str)}) Tj`);
  }
  ops.push("ET");
  return ops.join("\n");
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildOutlineObjects(
  nodes: FixtureOutline[],
  start: number,
  pageRef: (page: number) => string,
): { root: number; objects: string[] } {
  const objects: string[] = [];
  const root = start;
  const ids = nodes.map((_, i) => start + 1 + i);
  objects.push(
    `<< /Type /Outlines /First ${ids[0]} 0 R /Last ${ids[ids.length - 1]} 0 R /Count ${nodes.length} >>`,
  );
  nodes.forEach((node, i) => {
    const destPage = Math.max(1, node.page);
    const dest = `[${pageRef(destPage)} /XYZ 0 792 0]`;
    const parts = [
      `/Title (${escapePdf(node.title)})`,
      `/Parent ${root} 0 R`,
      `/Dest ${dest}`,
    ];
    if (i > 0) parts.push(`/Prev ${ids[i - 1]} 0 R`);
    if (i < nodes.length - 1) parts.push(`/Next ${ids[i + 1]} 0 R`);
    objects.push(`<< ${parts.join(" ")} >>`);
  });
  return { root, objects };
}

function assemble(objects: string[], encryptRef?: string): Uint8Array {
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const encrypt = encryptRef ? ` /Encrypt ${encryptRef}` : "";
  const id = encryptRef ? " /ID [<0123456789ABCDEF0123456789ABCDEF> <0123456789ABCDEF0123456789ABCDEF>]" : "";
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt}${id} >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref + trailer);
}
