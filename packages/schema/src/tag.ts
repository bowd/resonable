import { CoMap, CoList, co } from "jazz-tools";

export class Tag extends CoMap {
  name = co.string;
  color = co.string;
  archived = co.boolean;
}

export class TagList extends CoList.Of(co.ref(Tag)) {}
