// The one place the browser talks to a node.
//
// Three apps share this rather than each writing their own fetch calls. The
// three surfaces are genuinely different products and are built separately —
// but what they say to the server is identical, and three copies of that would
// drift exactly the way two price cascades and two tills did.

export * from "./error";
export * from "./node";
export * from "./auth";
export * from "./sync";
export * from "./dc";
