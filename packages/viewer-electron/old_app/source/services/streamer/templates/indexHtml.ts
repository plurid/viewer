// #region imports
    // #region internal
    import {
        html,
    } from './base';
    // #endregion internal
// #endregion imports



// #region module
const indexHtml = (
    name: string,
) => html(
    name,
`
<body>
    <div class="viewer">plurid viewer stream</div>
</body>
`);
// #endregion module



// #region exports
export default indexHtml;
// #endregion exports
