import { co, z } from "jazz-tools";

export const Category = co.map({
  name: z.string(),
  color: z.string(),
  icon: z.optional(z.string()),
  get parent(): co.Optional<typeof Category> {
    return co.optional(Category);
  },
  archived: z.boolean(),
});
export type Category = co.loaded<typeof Category>;

export const CategoryList = co.list(Category);
export type CategoryList = co.loaded<typeof CategoryList>;
