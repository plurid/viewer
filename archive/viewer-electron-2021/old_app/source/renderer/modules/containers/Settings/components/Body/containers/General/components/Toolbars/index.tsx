import React from 'react';

const A: React.FC<any> = () => {
    return (<div></div>);
}

export default A;


// // #region imports
//     // #region libraries
//     import React, {
//         useState,
//         useEffect,
//     } from 'react';

//     import { AnyAction } from 'redux';
//     import { connect } from 'react-redux';
//     import { ThunkDispatch } from 'redux-thunk';

//     import {
//         OwnerSpaceUIToolbars,
//     } from '@plurid/apps.libraries.data.interfaces.global';

//     import {
//         Theme,
//     } from '@plurid/plurid-themes';

//     import {
//         useDebouncedCallback,
//     } from '@plurid/apps.libraries.frontends.components';
//     // #endregion libraries


//     // #region external
//     import {
//         StyledPluridFormline,
//     } from '~renderer-containers/Settings/components/Body/styled';

//     import {
//         // PluridSlider,
//         PluridSwitch,
//     } from '~renderer-services/styled';

//     // import {
//     //     databaseSetToolbars as databaseSetToolbarsFunction,
//     // } from '~kernel-containers/Settings/logic';

//     import { AppState } from '~renderer-services/state/store';
//     import StateContext from '~renderer-services/state/context';
//     import selectors from '~renderer-services/state/selectors';
//     import actions from '~renderer-services/state/actions';
//     // #endregion external


//     // #region internal
//     import {
//         StyledToolbars,
//     } from './styled';
//     // #endregion internal
// // #endregion imports



// // #region module
// const toolbarFields = {
//     alwaysShow: 'alwaysShow',
//     showNames: 'showNames',
//     scaleIcons: 'scaleIcons',
// }

// export interface ToolbarOwnProperties {
// }

// export interface ToolbarStateProperties {
//     stateGeneralTheme: Theme;
//     stateInteractionTheme: Theme;
//     stateProductUIToolbars: OwnerSpaceUIToolbars;
//     stateIdentonym: string;
// }

// export interface ToolbarDispatchProperties {
//     dispatchToggleProductUIToolbarsShowToolbar: typeof actions.product.toggleProductUIToolbarsShowToolbar;
//     dispatchToggleProductUIToolbarsShowNames: typeof actions.product.toggleProductUIToolbarsShowNames;
//     dispatchToggleProductUIToolbarsScaleIcons: typeof actions.product.toggleProductUIToolbarsScaleIcons;
// }

// export type ToolbarProperties =
//     & ToolbarOwnProperties
//     & ToolbarStateProperties
//     & ToolbarDispatchProperties;


// const Toolbars: React.FC<ToolbarProperties> = (
//     properties,
// ) => {
//     // #region properties
//     const {
//         // #region state
//         stateGeneralTheme,
//         stateInteractionTheme,
//         stateProductUIToolbars,
//         stateIdentonym,
//         // #endregion state

//         // #region dispatch
//         dispatchToggleProductUIToolbarsShowToolbar,
//         dispatchToggleProductUIToolbarsShowNames,
//         dispatchToggleProductUIToolbarsScaleIcons,
//         // #endregion dispatch
//     } = properties;

//     const {
//         alwaysShow,
//         showNames,
//         scaleIcons,
//     } = stateProductUIToolbars;
//     // #endregion properties


//     // #region state
//     const [localAlwaysShow, setLocalAlwaysShow] = useState(alwaysShow);
//     const [localShowNames, setLocalShowNames] = useState(showNames);
//     const [localScaleIcons, setLocalScaleIcons] = useState(scaleIcons);
//     // #endregion state


//     // #region handlers
//     const databaseSetToolbars = useDebouncedCallback(
//         // databaseSetToolbarsFunction,
//         () => {},
//         1000,
//     );

//     const handleToolbarChange = (
//         type: string,
//     ) => {
//         switch (type) {
//             case toolbarFields.alwaysShow:
//                 {
//                     const value = !localAlwaysShow;
//                     setLocalAlwaysShow(value);
//                     dispatchToggleProductUIToolbarsShowToolbar(value);
//                     const data: Partial<OwnerSpaceUIToolbars> = {
//                         alwaysShow: value,
//                         showNames,
//                         scaleIcons,
//                     };
//                     if (stateIdentonym) {
//                         // databaseSetToolbars(data);
//                     }
//                     break;
//                 }
//             case toolbarFields.showNames:
//                 {
//                     const value = !localShowNames;
//                     setLocalShowNames(value);
//                     dispatchToggleProductUIToolbarsShowNames(value);
//                     const data: Partial<OwnerSpaceUIToolbars> = {
//                         alwaysShow,
//                         showNames: value,
//                         scaleIcons,
//                     };
//                     if (stateIdentonym) {
//                         // databaseSetToolbars(data);
//                     }
//                     break;
//                 }
//             case toolbarFields.scaleIcons:
//                 {
//                     const value = !localScaleIcons;
//                     setLocalScaleIcons(value);
//                     dispatchToggleProductUIToolbarsScaleIcons(value);
//                     const data: Partial<OwnerSpaceUIToolbars> = {
//                         alwaysShow,
//                         showNames,
//                         scaleIcons: value,
//                     };
//                     if (stateIdentonym) {
//                         // databaseSetToolbars(data);
//                     }
//                     break;
//                 }
//         }
//     }
//     // #endregion handlers


//     // #region effects
//     useEffect(() => {
//         setLocalAlwaysShow(alwaysShow);
//         setLocalShowNames(showNames);
//         setLocalScaleIcons(scaleIcons);
//     }, [
//         alwaysShow,
//         showNames,
//         scaleIcons,
//     ]);
//     // #endregion effects


//     // #region render
//     return (
//         <StyledToolbars>
//             <h2>
//                 toolbars
//             </h2>

//             <StyledPluridFormline
//                 text="always show"
//                 theme={stateGeneralTheme}
//             >
//                 <PluridSwitch
//                     theme={stateInteractionTheme}
//                     checked={localAlwaysShow}
//                     atChange={() => handleToolbarChange(toolbarFields.alwaysShow)}
//                     exclusive={true}
//                 />
//             </StyledPluridFormline>

//             <StyledPluridFormline
//                 text="show names"
//                 theme={stateGeneralTheme}
//             >
//                 <PluridSwitch
//                     theme={stateInteractionTheme}
//                     checked={localShowNames}
//                     atChange={() => handleToolbarChange(toolbarFields.showNames)}
//                     exclusive={true}
//                 />
//             </StyledPluridFormline>

//             <StyledPluridFormline
//                 text="scale icons"
//                 theme={stateGeneralTheme}
//             >
//                 <PluridSwitch
//                     theme={stateInteractionTheme}
//                     checked={localScaleIcons}
//                     atChange={() => handleToolbarChange(toolbarFields.scaleIcons)}
//                     exclusive={true}
//                 />
//             </StyledPluridFormline>

//             {/* <StyledPluridFormline
//                 // MAYBE
//                 text="position"
//                 theme={stateGeneralTheme}
//             >
//                 <PluridSlider
//                     theme={stateInteractionTheme}
//                     value={30}
//                     atChange={() => {}}
//                     defaultValue={50}
//                     min={0}
//                     max={100}
//                     thumbSize="large"
//                 />
//             </StyledPluridFormline> */}
//         </StyledToolbars>
//     );
//     // #endregion render
// }


// const mapStateToProperties = (
//     state: AppState,
// ): ToolbarStateProperties => ({
//     stateGeneralTheme: selectors.themes.getGeneralTheme(state),
//     stateInteractionTheme: selectors.themes.getInteractionTheme(state),
//     stateProductUIToolbars: selectors.product.getProductUI(state).toolbars,
//     stateIdentonym: selectors.owner.getIdentonym(state),
// });


// const mapDispatchToProperties = (
//     dispatch: ThunkDispatch<{}, {}, AnyAction>,
// ): ToolbarDispatchProperties => ({
//     dispatchToggleProductUIToolbarsShowToolbar: (
//         value,
//     ) => dispatch(
//         actions.product.toggleProductUIToolbarsShowToolbar(value)
//     ),
//     dispatchToggleProductUIToolbarsShowNames: (
//         value,
//     ) => dispatch(
//         actions.product.toggleProductUIToolbarsShowNames(value)
//     ),
//     dispatchToggleProductUIToolbarsScaleIcons: (
//         value,
//     ) => dispatch(
//         actions.product.toggleProductUIToolbarsScaleIcons(value)
//     ),
// });


// const ConnectedToolbars = connect(
//     mapStateToProperties,
//     mapDispatchToProperties,
//     null,
//     {
//         context: StateContext,
//     },
// )(Toolbars);
// // #endregion module



// // #region external
// export default ConnectedToolbars;
// // #endregion external
