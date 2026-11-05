import { z } from "zod";

export const CATEGORIES = ["policy", "sop", "standard", "manual", "contract"] as const;

export const Metadata = z.object({
  title: z.string().trim().min(3, "title needs at least 3 characters"),
  category: z.enum(CATEGORIES, { message: "pick a category" }),
  owner: z.string().trim().min(2, "name an owning department"),
  reviewCycleMonths: z.number().int().min(1, "review cycle must be at least 1 month").max(60, "review cycle is at most 60 months"),
  dir: z.enum(["ltr", "rtl"]),
});
export type Metadata = z.infer<typeof Metadata>;

export function metadataErrors(m: unknown): string[] {
  const r = Metadata.safeParse(m);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}
