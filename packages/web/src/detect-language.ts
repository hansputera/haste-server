// Guessing a paste's language when it names none.
//
// Every v1 paste arrives without a language, and `Auto-detect` is an explicit
// choice in the picker, so this cannot stay a no-op — it would mean the editor
// offers a setting that does nothing.
//
// The rules are a score, not a first match: markup carries a `<` on nearly
// every line, so a plain "does it match" test would let it beat a language that
// merely mentions a few keywords. Ordered most specific first so a tie goes to
// the narrower grammar.

const RULES: readonly { language: string; pattern: RegExp; weight?: number }[] = [
  // `x: string` / interfaces only appear in TypeScript, which JavaScript must
  // not win by also matching `const`.
  { language: 'typescript', pattern: /\b(interface|implements|readonly|declare)\b/g, weight: 3 },
  { language: 'typescript', pattern: /:\s*(string|number|boolean|void)\b/g, weight: 2 },
  { language: 'javascript', pattern: /\b(const|let|var)\s+\w+\s*=/g, weight: 2 },
  {
    language: 'javascript',
    pattern: /=>|\brequire\(|\bmodule\.exports\b|\bexport\s+(default|const)\b/g
  },
  { language: 'python', pattern: /^\s*(def|class)\s+\w+.*:\s*$/gm, weight: 3 },
  { language: 'python', pattern: /\b__name__\b|\bself\b|\bprint\(/g },
  { language: 'ruby', pattern: /^\s*(def|class|module)\s|^\s*end\s*$/gm, weight: 2 },
  { language: 'ruby', pattern: /\bputs\b|\bdo\s*\|\w+\|/g },
  { language: 'go', pattern: /\bfunc\s+(\(\w+\s+\*?\w+\)\s*)?\w+\(/g, weight: 2 },
  { language: 'go', pattern: /\bpackage\s+\w+\b|:=/g, weight: 2 },
  { language: 'rust', pattern: /\bfn\s+\w+\(|\blet\s+mut\b|\bimpl\b/g, weight: 2 },
  {
    language: 'java',
    pattern: /\b(public|private|protected)\s+(static\s+)?(final\s+)?(class|void|int|String)\b/g,
    weight: 2
  },
  { language: 'php', pattern: /<\?php|^\s*\$[A-Za-z_]\w*\s*=/gm, weight: 2 },
  {
    language: 'sql',
    pattern: /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/gi,
    weight: 2
  },
  { language: 'css', pattern: /[.#][\w-]+\s*\{[^}]*:[^}]*;\s*\}/g },
  { language: 'bash', pattern: /^#!.*\b(sh|bash)\b|^\s*\w+\s+--?[a-z][\w-]*/gm },
  { language: 'json', pattern: /^\s*[[{][\s\S]*"[^"]+"\s*:/ },
  { language: 'xml', pattern: /<\/?[a-zA-Z][\w:-]*(\s[^>]*)?>/g, weight: 1 },
  { language: 'markdown', pattern: /^#{1,6}\s+\w|^\s*[-*]\s+\w/gm }
];

/**
 * The grammar `text` most resembles, or `null` when nothing scores — which the
 * caller renders as plain text rather than colouring it wrongly.
 */
export const detectLanguage = (text: string): string | null => {
  const scores = new Map<string, number>();

  for (const { language, pattern, weight = 1 } of RULES) {
    const matches = text.match(pattern);
    if (!matches) continue;
    scores.set(language, (scores.get(language) ?? 0) + matches.length * weight);
  }

  let best: { language: string; score: number } | null = null;

  for (const [language, score] of scores) {
    if (!best || score > best.score) best = { language, score };
  }

  return best ? best.language : null;
};
