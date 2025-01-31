import React from 'react';

const A: React.FC<any> = () => {
    return (<div></div>);
}

export default A;


// // #region imports
//     // #region libraries
//     import React from 'react';

//     import { AnyAction } from 'redux';
//     import { connect } from 'react-redux';
//     import { ThunkDispatch } from 'redux-thunk';

//     import {
//         Theme,
//     } from '@plurid/plurid-themes';

//     import {
//         keyModifiers,
//     } from '@plurid/apps.libraries.data.constants.global';

//     import {
//         keys,
//     } from '@plurid/apps.libraries.logic.utilities';
//     // #endregion libraries


//     // #region external
//     import {
//         StyledFormline,
//     } from '~renderer-containers/Settings/components/Body/styled';

//     // import {
//     //     databaseSetSpaces as databaseSetSpacesFunction,
//     // } from '~renderer-containers/Settings/logic';

//     import {
//         shortcuts,
//         shortcutsNames,
//     } from '~renderer-data/constants/shortcuts';

//     import { AppState } from '~renderer-services/state/store';
//     import StateContext from '~renderer-services/state/context';
//     import selectors from '~renderer-services/state/selectors';
//     import actions from '~renderer-services/state/actions';
//     // #endregion external


//     // #region internal
//     import {
//         StyledShortcuts,
//     } from './styled';
//     // #endregion internal
// // #endregion imports



// // #region module
// export interface ShortcutsOwnProperties {
// }

// export interface ShortcutsStateProperties {
//     stateGeneralTheme: Theme,
//     stateInteractionTheme: Theme,
//     stateUI: any;
// }

// export interface ShortcutsDispatchProperties {
// }

// export type ShortcutsProperties =
//     & ShortcutsOwnProperties
//     & ShortcutsStateProperties
//     & ShortcutsDispatchProperties;


// const Shortcuts: React.FC<ShortcutsProperties> = (
//     properties,
// ) => {
//     // #region properties
//     // const {
//     //     // #region state
//     //     // stateGeneralTheme,
//     //     // stateInteractionTheme,
//     //     // stateUI,
//     //     // #endregion state
//     // } = properties;
//     // #endregion properties


//     // #region render
//     return (
//         <StyledShortcuts>
//             <h2>
//                 shortcuts
//             </h2>

//             <StyledFormline>
//                 <ul>
//                     {shortcuts.map(shortcut => {
//                         const {
//                             type,
//                             key,
//                             modifier,
//                         } = shortcut;

//                         const name = shortcutsNames[type].name;
//                         const modifierText = modifier
//                             ? keyModifiers[modifier]
//                             : '';
//                         const keyText = shortcutsNames[type].key || keys.keyCodeToKey(key);

//                         return (
//                             <li
//                                 key={type}
//                             >
//                                 <div>
//                                     {name}
//                                 </div>
//                                 <div style={{display: 'flex'}}>
//                                     {modifierText}
//                                     {modifierText ? (<>&nbsp;</>) : ''}
//                                     {keyText}
//                                 </div>
//                             </li>
//                         );
//                     })}
//                 </ul>
//             </StyledFormline>
//         </StyledShortcuts>
//     );
//     // #endregion render
// }


// const mapStateToProperties = (
//     state: AppState,
// ): ShortcutsStateProperties => ({
//     stateGeneralTheme: selectors.themes.getGeneralTheme(state),
//     stateInteractionTheme: selectors.themes.getInteractionTheme(state),
//     stateUI: selectors.product.getProductUI(state),
// });


// const mapDispatchToProperties = (
//     dispatch: ThunkDispatch<{}, {}, AnyAction>,
// ): ShortcutsDispatchProperties => ({
// });


// const ConnectedShortcuts = connect(
//     mapStateToProperties,
//     mapDispatchToProperties,
//     null,
//     {
//         context: StateContext,
//     },
// )(Shortcuts);
// // #endregion module



// // #region external
// export default ConnectedShortcuts;
// // #endregion external
