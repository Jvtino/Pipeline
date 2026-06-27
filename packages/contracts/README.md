# @pipeline/contracts

The one definition of Pipeline's data contract — the unified thread shape every
surface (hosted web, mobile, API, classifier) speaks:

```ts
{ threadId, domain, subject, messages: [{ date, from, body }] }
```

Defined as [zod](https://zod.dev) schemas with inferred types, so raw → unified
mapping is **type-checked and runtime-validated at the boundary** instead of trusted.
`body` is always a short snippet (≤600 chars), never a full raw email — the privacy
posture is baked into the shape. See `docs/Pipeline-Transformation-Plan.md` §7.

```ts
import { parseThread, type Thread, type Status } from "@pipeline/contracts";
const thread = parseThread(await res.json()); // throws on a bad shape
```
