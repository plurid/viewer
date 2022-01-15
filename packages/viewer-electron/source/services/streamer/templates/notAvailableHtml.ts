// #region imports
    // #region internal
    import {
        html,
    } from './base';
    // #endregion internal
// #endregion imports



// #region module
const notAvailableHtml = (
    name: string,
) => html(
    name,
`
<body>
    <div class="viewer">doesn't look like anything</div>
</body>
`);
// #endregion module



// #region exports
export default notAvailableHtml;
// #endregion exports
