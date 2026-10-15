// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconBlocks,
        PluridIconList,
        PluridIconColumns,
        PluridIconGallery,
        PluridIconPlurid,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    import {
        StyledTopBarButton,
    } from '~renderer-planes/Files/components/FilesTopBar/styled';
    // #endregion external


    // #region internal
    import {
        StyledViewModes,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface ViewModesProperties {
    // #region required
        // #region values
        theme: Theme;
        viewShowAs: string;
        setViewShowAs: (showAs: string) => void;
        pluridLinkNavigation: boolean;
        setPluridLinkNavigation: (pluridLinkNavigation: boolean) => void;
        // #endregion values

        // #region methods
        // #endregion methods
    // #endregion required
}

const ViewModes: React.FC<ViewModesProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            viewShowAs,
            setViewShowAs,
            pluridLinkNavigation,
            setPluridLinkNavigation,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region render
    return (
        <StyledViewModes
            theme={theme}
        >
            <StyledTopBarButton
                theme={theme}
                active={viewShowAs === 'BLOCKS'}
                onClick={() => setViewShowAs('BLOCKS')}
            >
                <PluridIconBlocks
                    theme={theme}
                    title="Show as Blocks"
                />
            </StyledTopBarButton>

            <StyledTopBarButton
                theme={theme}
                active={viewShowAs === 'LIST'}
                onClick={() => setViewShowAs('LIST')}
            >
                <PluridIconList
                    theme={theme}
                    title="Show as List"
                />
            </StyledTopBarButton>

            <StyledTopBarButton
                theme={theme}
                active={viewShowAs === 'COLUMNS'}
                onClick={() => setViewShowAs('COLUMNS')}
            >
                <PluridIconColumns
                    theme={theme}
                    title="Show as Columns"
                />
            </StyledTopBarButton>

            <StyledTopBarButton
                theme={theme}
                active={viewShowAs === 'GALLERY'}
                onClick={() => setViewShowAs('GALLERY')}
            >
                <PluridIconGallery
                    theme={theme}
                    title="Show as Gallery"
                />
            </StyledTopBarButton>


            <StyledTopBarButton
                theme={theme}
                active={pluridLinkNavigation}
                style={{
                    marginLeft: '1rem',
                }}
                onClick={() => setPluridLinkNavigation(!pluridLinkNavigation)}
            >
                <PluridIconPlurid
                    theme={theme}
                    title="Plurid Link Navigation"
                />
            </StyledTopBarButton>
        </StyledViewModes>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default ViewModes;
// #endregion exports
