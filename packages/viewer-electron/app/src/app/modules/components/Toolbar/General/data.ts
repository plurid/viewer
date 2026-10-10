// #region imports
    // #region libraries
    import {
        PluridIconSpace,
        PluridIconSettings,
    } from '@plurid/plurid-icons-react';

    import {
        ToolbarButton,
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries


    // #region external
    import {
        Language,
    } from '~renderer-data/languages';
    // #endregion external
// #endregion imports



// #region module
const computeButtons = (
    language: Language,
) => {
    const buttons: ToolbarButton[] = [
        {
            type: '/space',
            text: language.toolbar.space,
            icon: PluridIconSpace,
            first: true,
        },
        {
            type: '/settings',
            text: language.toolbar.settings,
            icon: PluridIconSettings,
        },
    ];

    return buttons;
}
// #endregion module



// #region exports
export default computeButtons;
// #endregion exports
