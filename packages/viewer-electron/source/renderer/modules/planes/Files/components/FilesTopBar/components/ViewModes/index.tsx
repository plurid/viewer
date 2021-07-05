// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconSpace,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledViewModes,
        StyledViewMode,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface ViewModesProperties {
    // #region required
        // #region values
        theme: Theme;
        viewShowAs: string;
        setViewShowAs: React.Dispatch<React.SetStateAction<string>>;
        pluridLinkNavigation: boolean;
        setPluridLinkNavigation: React.Dispatch<React.SetStateAction<boolean>>;
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
            <StyledViewMode
                theme={theme}
                active={viewShowAs === 'ICONS'}
            >
                <PluridIconSpace
                    theme={theme}
                    title="Show as Icons"
                    atClick={() => setViewShowAs('ICONS')}
                />
            </StyledViewMode>

            <StyledViewMode
                theme={theme}
                active={viewShowAs === 'LIST'}
            >
                <PluridIconSpace
                    theme={theme}
                    title="Show as List"
                    atClick={() => setViewShowAs('LIST')}
                />
            </StyledViewMode>

            <StyledViewMode
                theme={theme}
                active={viewShowAs === 'COLUMNS'}
            >
                <PluridIconSpace
                    theme={theme}
                    title="Show as Columns"
                    atClick={() => setViewShowAs('COLUMNS')}
                />
            </StyledViewMode>

            <StyledViewMode
                theme={theme}
                active={viewShowAs === 'GALLERY'}
            >
                <PluridIconSpace
                    theme={theme}
                    title="Show as Gallery"
                    atClick={() => setViewShowAs('GALLERY')}
                />
            </StyledViewMode>


            <StyledViewMode
                theme={theme}
                active={pluridLinkNavigation}
                style={{
                    marginLeft: '1rem',
                }}
            >
                <PluridIconSpace
                    theme={theme}
                    title="Plurid Link Navigation"
                    atClick={() => setPluridLinkNavigation(active => !active)}
                />
            </StyledViewMode>
        </StyledViewModes>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default ViewModes;
// #endregion exports
