// #region imports
    // #region libraries
    import React, {
        useState,
    } from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';

    import {
        PluridIconArrowDown,
    } from '@plurid/plurid-icons-react';
    // #endregion libraries


    // #region external
    // #endregion external


    // #region internal
    import {
        StyledAccessList,
        StyledAccessListHead,
        StyledAccessListBody,
        StyledAccessListItem,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface AccessListProperties {
    // #region required
        // #region values
        theme: Theme;
        title: string;
        items: {
            name: string;
            directory: string;
        }[];
        viewDirectory: string;
        // #endregion values

        // #region methods
        setViewDirectory: (directory: string) => void;
        // #endregion methods
    // #endregion required
}

const AccessList: React.FC<AccessListProperties> = (
    properties,
) => {
    // #region properties
    const {
        // #region required
            // #region values
            theme,
            title,
            items,
            viewDirectory,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region state
    const [
        show,
        setShow,
    ] = useState(false);
    // #endregion state


    // #region render
    return (
        <StyledAccessList
            theme={theme}
        >
            <StyledAccessListHead
                onClick={() => setShow(!show)}
            >
                <div>
                    {title}
                </div>

                <PluridIconArrowDown
                    size="small"
                />
            </StyledAccessListHead>

            {show && (
                <StyledAccessListBody>
                    {items.map(item => {
                        const {
                            directory,
                            name,
                        } = item;

                        return (
                            <StyledAccessListItem
                                key={title + directory}
                                active={viewDirectory.startsWith(directory)}
                            >
                                {name}
                            </StyledAccessListItem>
                        );
                    })}
                </StyledAccessListBody>
            )}
        </StyledAccessList>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default AccessList;
// #endregion exports
