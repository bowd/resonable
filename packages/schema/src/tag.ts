import { co, z } from "jazz-tools";

export const Tag = co.map({
  name: z.string(),
  color: z.string(),
  archived: z.boolean(),
});
export type Tag = co.loaded<typeof Tag>;

export const TagList = co.list(Tag);
export type TagList = co.loaded<typeof TagList>;
