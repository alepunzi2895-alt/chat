const aliases: Record<string, string> = {
  ale0095: "amoremio",
  silvia0088: "amoretuo",
};

export function normalizeNickname(nickname: string) {
  const clean = nickname.trim().replace(/\s+/g, " ").slice(0, 24);
  return aliases[clean.toLowerCase()] ?? clean;
}

export function displayNickname(nickname: string, ownNickname: string) {
  const normalized = normalizeNickname(nickname);
  if (normalized === "amoremio" || normalized === "amoretuo") return normalized;
  return nickname === ownNickname ? "amoremio" : "amoretuo";
}
