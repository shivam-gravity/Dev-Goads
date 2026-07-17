import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Minimal formatter for strategist replies — bold text, bullet/numbered
 * lists, and paragraph breaks. Avoids pulling in a markdown library +
 * dangerouslySetInnerHTML for what's normally a handful of lightly
 * formatted lines.
 */
export default function FormattedMessage({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (!listBuffer.length || !listType) return;
    const ListTag = listType;
    blocks.push(
      <ListTag key={`list-${blocks.length}`}>
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ListTag>
    );
    listBuffer = [];
    listType = null;
  };

  text.split("\n").forEach((line, i) => {
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)/);
    const numberedMatch = line.match(/^\s*\d+\.\s+(.*)/);

    if (bulletMatch) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listBuffer.push(bulletMatch[1]);
    } else if (numberedMatch) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listBuffer.push(numberedMatch[1]);
    } else {
      flushList();
      if (line.trim()) blocks.push(<p key={`p-${i}`}>{renderInline(line)}</p>);
    }
  });
  flushList();

  return <>{blocks}</>;
}
