// #region imports
    // #region libraries
    import React, {
        useState,
    } from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconMore,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    import {
        StyledTopBarButton,
    } from '~renderer-planes/Files/components/FilesTopBar/styled';
    // #endregion external


    // #region internal
    import {
        StyledActions,
        StyledActionsMenu,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface ActionsProperties {
    // #region required
        // #region values
        theme: Theme;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const Actions: React.FC<ActionsProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region state
    const [
        showActions,
        setShowActions,
    ] = useState(false);
    // #endregion state


    // #region render
    return (
        <StyledActions
            theme={theme}
        >
            <StyledTopBarButton
                theme={theme}
                active={showActions}
            >
                <PluridIconMore
                    theme={theme}
                    title="Actions"
                    atClick={() => setShowActions(active => !active)}
                />
            </StyledTopBarButton>

            {showActions && (
                <StyledActionsMenu
                    theme={theme}
                    style={{
                        left: '700px',
                    }}
                >
                    <div>
                        New Folder
                    </div>

                    <div>
                        Open in New Plane
                    </div>

                    <div>
                        Group By
                    </div>
                </StyledActionsMenu>
            )}
        </StyledActions>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Actions;
// #endregion exports
