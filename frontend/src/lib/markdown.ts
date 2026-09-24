/**
 * Models often write math as \( … \) and \[ … \] (LaTeX style), but
 * remark-math only understands dollar signs. Convert outside code so both
 * render. Inline math uses $$…$$ inside a line (remark-math treats that as
 * inline), which lets us keep single "$" as plain text: "$5 and $10" stays
 * money, not math.
 */
export function normaliseMath(markdown: string): string {
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) return markdown;

  // Split on fenced code blocks and inline code spans; odd indexes are code.
  const parts = markdown.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `\n$$\n${body.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$$${body.trim()}$$`);
    })
    .join("");
}
