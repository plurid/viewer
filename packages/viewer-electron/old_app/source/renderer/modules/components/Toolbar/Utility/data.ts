// #region imports
    // #region libraries
    import {
        PluridIconExpandPlus,
        PluridIconDocuments,
    } from '@plurid/plurid-icons-react';


    import {
        ToolbarButton,
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries
// #endregion imports



// #region module
const buttons: ToolbarButton[] = [
    {
        type: 'ADD_PLANE',
        text: 'add plane',
        icon: PluridIconExpandPlus,
        first: true,
    },
    {
        type: 'PLANE_LIST',
        text: 'plane list',
        icon: PluridIconDocuments,
        last: true,
    },
];
// #endregion module



// #region exports
export default buttons;
// #endregion exports
