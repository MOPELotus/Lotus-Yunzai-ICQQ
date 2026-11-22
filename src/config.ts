export type LegacyAccountIssue = "invalid-format" | "invalid-account" | "invalid-platform" | "duplicate-account";

export interface LegacyAccount {
  readonly account: number;
  readonly password?: string;
  readonly platform?: number;
  readonly version?: string;
  readonly signEndpoint?: string;
}

export interface LegacyAccountCandidate {
  readonly index: number;
  readonly status: "candidate";
  readonly account: number;
  readonly hasPassword: boolean;
  readonly hasSignEndpoint: boolean;
}

export type LegacyDiscovery =
  | LegacyAccountCandidate
  | { readonly index: number; readonly status: LegacyAccountIssue };

export function qqNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>> : undefined;
}

export function parseLegacyAccount(value: unknown): LegacyAccount | LegacyAccountIssue {
  if (typeof value !== "string" || /[\r\n\0]/u.test(value)) return "invalid-format";
  const [account = "", password = "", platform = "", version = "", ...remainder] = value.split(":");
  const id = /^[1-9]\d*$/u.test(account) ? qqNumber(Number(account)) : undefined;
  if (!id) return "invalid-account";
  const platformId = platform && /^\d+$/u.test(platform) ? qqNumber(Number(platform)) : undefined;
  if (platform && !platformId) return "invalid-platform";
  return {
    account: id, ...(password ? { password } : {}),
    ...(platformId ? { platform: platformId } : {}),
    ...(version ? { version } : {}),
    ...(remainder.join(":") ? { signEndpoint: remainder.join(":") } : {}),
  };
}

/** Metadata only. Discovery never emits credentials or builds a live client. */
export function discoverLegacyAccounts(config: unknown): LegacyDiscovery[] {
  const entries = record(config)?.token;
  if (!Array.isArray(entries)) return [];
  const seen = new Set<number>();
  return entries.map((entry, index) => {
    const parsed = parseLegacyAccount(entry);
    if (typeof parsed === "string") return { index, status: parsed };
    if (seen.has(parsed.account)) return { index, status: "duplicate-account" };
    seen.add(parsed.account);
    return { index, status: "candidate", account: parsed.account,
      hasPassword: Boolean(parsed.password), hasSignEndpoint: Boolean(parsed.signEndpoint) };
  });
}
