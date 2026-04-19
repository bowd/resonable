import { CoMap, CoList, co } from "jazz-tools";

export class Category extends CoMap {
  name = co.string;
  color = co.string;
  icon = co.optional.string;
  parent = co.optional.ref(Category);
  archived = co.boolean;
}

export class CategoryList extends CoList.Of(co.ref(Category)) {}
