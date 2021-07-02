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
//     // #endregion libraries


//     // #region external
//     import {
//         StyledFormline,
//         StyledPluridFormline,
//     } from '~renderer-containers/Settings/components/Body/styled';

//     import {
//         PluridSwitch,
//         PluridLinkButton,
//     } from '~renderer-services/styled';

//     import { AppState } from '~renderer-services/state/store';
//     import StateContext from '~renderer-services/state/context';
//     import selectors from '~renderer-services/state/selectors';
//     import actions from '~renderer-services/state/actions';
//     // #endregion external


//     // #region internal
//     import {
//         StyledSpace,
//     } from './styled';
//     // #endregion internal
// // #endregion imports



// // #region module
// export interface SpaceOwnProperties {
// }

// export interface SpaceStateProperties {
//     stateGeneralTheme: Theme;
//     stateInteractionTheme: Theme;
//     stateFullWidthView: boolean;
//     stateOpaqueExplorer: boolean;
// }

// export interface SpaceDispatchProperties {
//     dispatchSetGeneralField: typeof actions.general.setGeneralField;
// }

// export type SpaceProperties =
//     & SpaceOwnProperties
//     & SpaceStateProperties
//     & SpaceDispatchProperties;


// const Space: React.FC<SpaceProperties> = (
//     properties,
// ) => {
//     // #region properties
//     const {
//         // #region state
//         stateGeneralTheme,
//         stateInteractionTheme,
//         stateFullWidthView,
//         stateOpaqueExplorer,
//         // #endregion state

//         // #region dispatch
//         dispatchSetGeneralField,
//         // #endregion dispatch
//     } = properties;
//     // #endregion properties


//     // #region handlers
//     const handleFullWidthView = () => {
//         dispatchSetGeneralField({
//             field: 'fullWidthView',
//             value: !stateFullWidthView,
//         });
//     }

//     const handleOpaqueExplorer = () => {
//         dispatchSetGeneralField({
//             field: 'opaqueExplorer',
//             value: !stateOpaqueExplorer,
//         });
//     }
//     // #endregion handlers


//     // #region render
//     return (
//         <StyledSpace>
//             <h2>
//                 space
//             </h2>

//             <StyledPluridFormline
//                 text="full width view"
//                 theme={stateGeneralTheme}
//             >
//                 <PluridSwitch
//                     theme={stateInteractionTheme}
//                     checked={stateFullWidthView}
//                     atChange={handleFullWidthView}
//                     exclusive={true}
//                 />
//             </StyledPluridFormline>

//             <StyledPluridFormline
//                 text="opaque explorer"
//                 theme={stateGeneralTheme}
//             >
//                 <PluridSwitch
//                     theme={stateInteractionTheme}
//                     checked={stateOpaqueExplorer}
//                     atChange={handleOpaqueExplorer}
//                     exclusive={true}
//                 />
//             </StyledPluridFormline>
//         </StyledSpace>
//     );
//     // #endregion render
// }


// const mapStateToProperties = (
//     state: AppState,
// ): SpaceStateProperties => ({
//     stateGeneralTheme: selectors.themes.getGeneralTheme(state),
//     stateInteractionTheme: selectors.themes.getInteractionTheme(state),
//     stateFullWidthView: selectors.general.getFullWidthView(state),
//     stateOpaqueExplorer: selectors.general.getOpaqueExplorer(state),
// });


// const mapDispatchToProperties = (
//     dispatch: ThunkDispatch<{}, {}, AnyAction>,
// ): SpaceDispatchProperties => ({
//     dispatchSetGeneralField: (
//         payload,
//     ) => dispatch(
//         actions.general.setGeneralField(payload),
//     ),
// });


// const ConnectedSpace = connect(
//     mapStateToProperties,
//     mapDispatchToProperties,
//     null,
//     {
//         context: StateContext,
//     },
// )(Space);
// // #endregion module



// // #region external
// export default ConnectedSpace;
// // #endregion external
