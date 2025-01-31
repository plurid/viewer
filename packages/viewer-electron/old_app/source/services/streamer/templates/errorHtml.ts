// #region imports
    // #region internal
    import {
        html,
    } from './base';
    // #endregion internal
// #endregion imports



// #region module
const errorHtml = (
    name: string,
) => html(
    name,
`
<body>
    <div class="viewer">something went wrong</div>
</body>
`);
// #endregion module



// #region exports
export default errorHtml;
// #endregion exports
