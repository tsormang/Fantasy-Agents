export const NAME_CATEGORIES = [
  { id: "latin", label: "Latin" },
  { id: "gothic", label: "Gothic" },
  { id: "ancient-greek", label: "Ancient Greek" },
  { id: "korean", label: "Korean" },
  { id: "fantasy", label: "Fantasy" },
  { id: "aristocrat", label: "Aristocrat" },
  { id: "norse", label: "Norse" },
  { id: "celtic", label: "Celtic" },
] as const;

export type NameCategory = (typeof NAME_CATEGORIES)[number]["id"];
const PREFIX = "@names:";
export const categoryAlias = (category: string): string => PREFIX + category;
export function nameCategory(alias: string | undefined): NameCategory | null {
  return NAME_CATEGORIES.find((c) => alias === categoryAlias(c.id))?.id ?? null;
}

const NAMES: Record<NameCategory, string[]> = {
  latin: ["Aurelius", "Livia", "Cassius", "Octavia", "Lucius", "Valeria", "Flavius", "Antonia", "Marcus", "Claudia", "Julius", "Sabina", "Felix", "Cornelia", "Titus", "Aelia", "Severus", "Priscilla", "Quintus", "Camilla"],
  gothic: ["Raven", "Lenore", "Lucien", "Morrigan", "Vesper", "Isolde", "Dorian", "Lilith", "Corvin", "Morticia", "Silas", "Elvira", "Alaric", "Drusilla", "Lazarus", "Ophelia", "Vlad", "Sable", "Ambrose", "Nyx"],
  "ancient-greek": ["Leonidas", "Athena", "Pericles", "Aspasia", "Lysander", "Thalia", "Demetrios", "Calliope", "Nikias", "Daphne", "Alexios", "Phoebe", "Theon", "Helena", "Socrates", "Ariadne", "Damon", "Penelope", "Achilles", "Iris"],
  korean: ["Min-jun", "Seo-yeon", "Ji-ho", "Ha-eun", "Seo-jun", "Ji-woo", "Do-yun", "Su-bin", "Hyun-woo", "Ha-rin", "Jun-seo", "Na-eun", "Si-woo", "Ye-jin", "Tae-hyun", "Da-eun", "Jae-min", "So-hee", "Seong-ho", "Yu-na"],
  fantasy: ["Aelric", "Sylvara", "Thorne", "Lyria", "Kael", "Elaria", "Fenris", "Nymera", "Draven", "Seraphine", "Vael", "Arwenna", "Theron", "Elowen", "Rowan", "Zephyra", "Orion", "Lunara", "Aldric", "Faelan"],
  aristocrat: ["Lord Edmund", "Lady Beatrice", "Duke Alistair", "Countess Evelyn", "Sir Percival", "Lady Arabella", "Baron Cedric", "Duchess Helena", "Lord Sebastian", "Lady Cordelia", "Count Leopold", "Lady Victoria", "Sir Reginald", "Lady Constance", "Lord Benedict", "Lady Rosalind", "Duke Theodore", "Countess Adelaide", "Baron Augustus", "Lady Eleanor"],
  norse: ["Bjorn", "Freya", "Erik", "Astrid", "Leif", "Sigrid", "Ivar", "Ingrid", "Ragnar", "Solveig", "Sten", "Hilda", "Torsten", "Eira", "Gunnar", "Runa", "Harald", "Thora", "Vidar", "Liv"],
  celtic: ["Cian", "Niamh", "Ronan", "Aoife", "Finn", "Maeve", "Declan", "Saoirse", "Oisin", "Brigid", "Cormac", "Aisling", "Eamon", "Ciara", "Fergus", "Orla", "Conall", "Roisin", "Brennan", "Deirdre"],
};

/** Choose once on the server; avoid names already in use in this category. */
export function randomAgentName(category: NameCategory, used: Set<string>): string {
  const available = NAMES[category].filter((name) => !used.has(name));
  const pool = available.length ? available : NAMES[category];
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  const base = pool[value % pool.length];
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}
