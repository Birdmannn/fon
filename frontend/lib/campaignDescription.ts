export function compactDescriptionBlankLines(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const compacted: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) {
      if (compacted.at(-1) !== "") compacted.push("");
    } else {
      compacted.push(line);
    }
  }

  return compacted.join("\n");
}
