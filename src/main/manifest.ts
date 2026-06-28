// Reading and validating the `game.json` manifest from the card (plan stage 3).
// The card is UNTRUSTED input (R7/P6): beyond the zod schema we validate path SEMANTICS —
// executable/heroImage/saveOnCard must live inside the card root (forbidding `..`
// and absolute paths), pcSavePath — only from the env-prefix whitelist.
import path from 'node:path';
import fse from 'fs-extra';
import { z } from 'zod';
import {
  MANIFEST_FILENAME,
  type GameManifest,
  type ResolvedManifest,
} from '../shared/types';

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z
    .string()
    .min(1)
    // id is used as a folder name on the PC (stats/pending-flush) — we forbid
    // separators and traversal so the card can't control paths outside its own folder.
    .regex(/^[A-Za-z0-9._-]+$/, 'id must match [A-Za-z0-9._-]')
    .refine((v) => v !== '.' && v !== '..', 'id must not be . or ..'),
  title: z.string().min(1),
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  heroImage: z.string().min(1).optional(),
  saveOnCard: z.string().min(1).optional(),
  pcSavePath: z.string().min(1).optional(),
  launchTimeoutSec: z.number().int().positive().default(30),
});

export type ManifestResult =
  | { readonly ok: true; readonly manifest: ResolvedManifest }
  | { readonly ok: false; readonly message: string };

const ENV_WHITELIST = ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE'] as const;

/** Resolves a card-relative path strictly inside its root. null = rejected. */
function resolveInside(root: string, relative: string): string | null {
  if (path.isAbsolute(relative)) return null;
  const resolved = path.resolve(root, relative);
  const back = path.relative(root, resolved);
  if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    return null;
  }
  return resolved;
}

type ExpandResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

/** Expands pcSavePath only from the env-prefix whitelist, without traversal. */
function expandPcSavePath(input: string): ExpandResult {
  const match = /^%([A-Za-z]+)%[\\/]?(.*)$/.exec(input);
  if (match === null) {
    return {
      ok: false,
      message: 'pcSavePath must start with %APPDATA%, %LOCALAPPDATA% or %USERPROFILE%',
    };
  }
  const envName = (match[1] ?? '').toUpperCase();
  if (!(ENV_WHITELIST as readonly string[]).includes(envName)) {
    return { ok: false, message: `pcSavePath env %${envName}% is not allowed` };
  }
  const base = process.env[envName];
  if (base === undefined || base === '') {
    return { ok: false, message: `environment variable %${envName}% is not set` };
  }
  const rest = match[2] ?? '';
  const segments = rest.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.includes('..')) {
    return { ok: false, message: 'pcSavePath must not contain ".."' };
  }
  const resolved = path.resolve(base, ...segments);
  const back = path.relative(base, resolved);
  if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    return { ok: false, message: 'pcSavePath escapes its base directory' };
  }
  return { ok: true, value: resolved };
}

function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (first === undefined) return 'invalid manifest';
  const where = first.path.join('.') || '(root)';
  return `${where}: ${first.message}`;
}

/**
 * Reads and fully validates the manifest at the card root.
 * Also checks that the executable exists (an edge case from the plan).
 */
export async function readManifest(root: string): Promise<ManifestResult> {
  const manifestPath = path.join(root, MANIFEST_FILENAME);

  let parsedJson: unknown;
  try {
    parsedJson = await fse.readJson(manifestPath);
  } catch (cause) {
    return { ok: false, message: `cannot read ${MANIFEST_FILENAME}: ${describe(cause)}` };
  }

  const parsed = manifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, message: formatZodError(parsed.error) };
  }
  const raw: GameManifest = parsed.data;

  const executablePath = resolveInside(root, raw.executable);
  if (executablePath === null) {
    return { ok: false, message: `executable path escapes card root: ${raw.executable}` };
  }
  if (!(await fse.pathExists(executablePath))) {
    return { ok: false, message: `executable not found: ${raw.executable}` };
  }

  let heroImagePath: string | undefined;
  if (raw.heroImage !== undefined) {
    const resolved = resolveInside(root, raw.heroImage);
    if (resolved === null) {
      return { ok: false, message: `heroImage path escapes card root: ${raw.heroImage}` };
    }
    heroImagePath = resolved;
  }

  let saveOnCardPath: string | undefined;
  if (raw.saveOnCard !== undefined) {
    const resolved = resolveInside(root, raw.saveOnCard);
    if (resolved === null) {
      return { ok: false, message: `saveOnCard path escapes card root: ${raw.saveOnCard}` };
    }
    saveOnCardPath = resolved;
  }

  let pcSavePath: string | undefined;
  if (raw.pcSavePath !== undefined) {
    const expanded = expandPcSavePath(raw.pcSavePath);
    if (!expanded.ok) {
      return { ok: false, message: expanded.message };
    }
    pcSavePath = expanded.value;
  }

  // Sync only makes sense if BOTH sides are set (section 3): the copy on the card and
  // the write location on the PC. If only one is set, the card was prepared incorrectly.
  if ((pcSavePath === undefined) !== (saveOnCardPath === undefined)) {
    return {
      ok: false,
      message: 'saveOnCard and pcSavePath must be set together or both omitted',
    };
  }

  const manifest: ResolvedManifest = {
    raw,
    root,
    executablePath,
    cwd: path.dirname(executablePath),
    ...(heroImagePath !== undefined ? { heroImagePath } : {}),
    ...(saveOnCardPath !== undefined ? { saveOnCardPath } : {}),
    ...(pcSavePath !== undefined ? { pcSavePath } : {}),
  };
  return { ok: true, manifest };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
