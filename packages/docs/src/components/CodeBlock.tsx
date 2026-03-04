import { codeToHtml } from "shiki";
import { CopyButton } from "./CopyButton";
import styles from "./CodeBlock.module.css";

interface CodeBlockProps {
  code: string;
  lang?: string;
  filename?: string;
  noCopy?: boolean;
}

export async function CodeBlock({ code, lang = "bash", filename, noCopy }: CodeBlockProps) {
  const trimmed = code.trim();
  const html = await codeToHtml(trimmed, {
    lang,
    theme: "github-light",
  });

  return (
    <div className={styles.container}>
      {filename && <span className={styles.label}>{filename}</span>}
      {!noCopy && <CopyButton text={trimmed} />}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
