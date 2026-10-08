# eCH schemas (test fixtures)

The official XSDs of eCH-0196 V2.2.0 and the eCH standards it imports (eCH-0007 V6, eCH-0008 V3,
eCH-0010 V7, eCH-0097 V4), used by `exports.handlers.spec.ts` to validate the E-Steuerauszug
(F10.10). They come from ech.ch, via the MIT project OpenSteuerAuszug (`specs/`). The only
change is that the `xs:import` `schemaLocation`s point at the local files instead of
`http://www.ech.ch/xmlns/…`, so validation works offline. eCH standards may be redistributed
freely (eCH-0196, chapter 5). See `docs/ECH-0196.md`.
