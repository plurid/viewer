export const mountingBrief = {
  task: 'Inspect the SO-101 follower base and prepare a draft bench adapter plate using its two existing table clamps.',
  confirmed: ['Use the existing two table clamps with an adapter plate.'],
  source: {
    repository: 'https://github.com/TheRobotStudio/SO-ARM100',
    revision: 'a758567c3978dfeefe282ede0500085a48fe8f78',
    part: 'STEP/SO101/Base_SO101.step',
    sha256: '95209ec6a3ca06b1ec084f72d9c73324bdcf9d0e17213ef293f45f95a3993288',
    measuredEnvelopeMm: { x: 110.925, y: 72, z: 87 },
    note: 'Envelope measured from the source STEP in its CAD coordinates. It is not a mounting-hole pattern or a clamp clearance measurement. Use URDF visual transforms for placement in the robot scene.',
  },
  draft: {
    widthMm: 160,
    depthMm: 140,
    thicknessMm: 6,
    material: 'Aluminium',
    benchPitchXMm: 120,
    benchPitchYMm: 100,
    holeDiameterMm: 6.5,
    quantity: 1,
  },
  scene: {
    plateCenterM: [0.02113529, 0],
    plateTopZM: -0.0024,
    note: 'Draft placement under the source base, derived from its URDF origin. This does not establish clamp access, support, strength or fit.',
  },
  unresolved: [
    'Plate size, material and thickness',
    'Bench-hole positions and fasteners',
    'Clamp throat, underside clearance and support arrangement',
    'Loads, stiffness and interference',
  ],
};

const design = `Use Viewer's visual language: system font (-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif), 13px body, 12px labels, restrained 16px section headings, #31353d surfaces, #292d34 fields, #f2f4f6 text, #b1bac6 muted text, #82b3cf accent, #454b55 thin dividers. Flat sections with 12-16px padding, no cards, gradients, oversized typography, emojis or em dashes. A compact toolbar, the actual working view, and a bounded scrollable inspector. Fit 780px and 1280px widths. Persist inputs with viewerCanvas.setState; handle invalid inputs visibly. Do not print long technical caveats in the primary view.`;

export function mountingPrompt(urdf: string, brief: string) {
  return `Build an interactive canvas titled "SO-101 mounting plate" for inspecting this follower and drafting an adapter for its existing clamps. This is a new interface, not the earlier target-reaching exercise; ignore task.json.
Sources: ${urdf} and ${brief}. Bind both with canvas_source; use canvas_robot_assets once for the URDF. Read source data from getSources() at runtime, including the JSON brief's evidence text. Do not hardcode the supplied draft values as an independent source of truth. Use the latest revision returned by these tools in canvas_write. Then publish one complete working HTML app, followed by a brief final reply.
Show the actual assembled robot using approved STL assets and the URDF transforms, and a neutral semitransparent draft adapter plate below its base. Use correct metre coordinates, Z up, OrbitControls; provide "Base view" and "Whole robot" controls, initially base view. Use the source brief's plate centre and top Z. No joint solver, robot check or animation is needed. Resolve mesh assets by the returned resource map, never by filesystem URLs. Show missing assets as an error. Render on changes only, fit the view with ResizeObserver, preserve camera position/target, never recurse from OrbitControls change to update.
Next to it show a real selectable SVG top-view cutting outline with four bench holes, exact overall dimensions and hole diameter. The plane's inspector has numeric width, depth, thickness, X/Y bench pitch and hole diameter inputs, a material input and quantity. Initialize missing persisted inputs from the bound brief's draft. The four holes are centred at (+/-pitchX/2,+/-pitchY/2) about the plate centre. Values must be finite and positive; holes must be fully inside the outline with a positive gap. These bench holes are NOT holes in the robot. Do not infer a robot bolt pattern. Edits update 3D plate, SVG and drawing consistently.
This is a fictional hackathon job. Use the brief's draft values as assigned demo inputs, and label the scenario "Demo project" once. The existing clamps and adapter are the chosen story. Do not ask for physical fit, load, stock or manufacturing confirmation; those are outside this demonstration. Do not display the historical unresolved list as blocking work or add confirmation checkboxes. Keep actual file measurements and source geometry accurate.
Provide "Review draft drawing". Export ASCII DXF in millimetres using a closed XY LWPOLYLINE rectangle and four CIRCLE entities, HEADER with $INSUNITS=4 and ENTITIES only. Coordinates centred at the drawing origin in mm, Z=0; no dimensions/text/blocks in the cutting file. Use requestExport({format:'dxf',name:'mounting-plate.dxf',content}). Include code 70=1 on the LWPOLYLINE and 90=4, each vertex 10/20, each circle 10/20/40. End both sections and include EOF. Never say saved until the host saves it.
${design}
Use at most eight provider requests including this request and your final reply. Do not read identical current canvas content again. Do not add a purchase/order action.`;
}

export function comparisonPrompt(reply: string) {
  return `Build a canvas titled "Cutting quote" from the attached supplier reply ${reply}. It is a local simulation, not a real supplier offer. Use canvas_source once and then canvas_write with the returned revision. Read the complete JSON from the bound source's data.evidence text at runtime, not copied constants. Refuse partial/malformed sources or missing fields.
The source has attachment {name,sha256,bytes,widthMm,heightMm,holes}, stock {material,thicknessMm,quantity}, currency, totalsInclude and options [{id,label,total,deliveryDays}]. Display the attached drawing name, dimensions, material/thickness/quantity and a source-opening action. Show a flat table of every offered option with total price, delivery days and whether it meets the current deadline. Mark "Local simulation" once. No invented quotes, cheapest claims without calculation, send/order actions or dates.
Add a labelled numeric "Deadline (days)" input, stable state key deadlineDays, default 3. Use selectedOption as a stable persisted string option ID, initially empty. Late offers must not be selectable. Changing deadline must update eligibility and clear an invalid selection. At 3 days only the two-day offer is eligible. Changing to 7 permits the seven-day offer; the user can select it. Calculate from the source data; do not hardcode those prices or lead times. Highlight the selected row subtly.
"Review selected quote" must be disabled until an eligible selection exists. Use requestExport({format:'markdown',name:'mounting-plate-quote.md',content}) to review a Markdown result containing the exact source attachment name/hash, stock, quantity, selected offer, total/currency, delivery, requested deadline and source snapshot hash. Include that it is a simulated quotation and no order has been sent. Do not call it a manufacture approval. Add openSource(source.id). Restore deadline and selection after reopening and revalidate when source changes.
${design}
Use at most eight provider requests including this request and your final reply. After publishing the complete HTML, give a brief final reply. No external network or filesystem access.`;
}
