// #region imports
    // #region libraries
    import React, {
        useRef,
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

    import {
        PluridFormbutton,
        PluridFormitem,
    } from '~renderer-services/styled';

    import {
        newFolder,
        newFile,
    } from '~renderer-services/logic/files';

    import DirectoryIcon from '../../../DirectoryIcon';
    import FileIcon from '../../../FileIcon';
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
        viewDirectory: string;
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
            viewDirectory,
            theme,
            // #endregion values

            // #region methods
            // #endregion methods
        // #endregion required
    } = properties;
    // #endregion properties


    // #region references
    const node = useRef<HTMLDivElement | null>(null);
    // #endregion references


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
            ref={node}
        >
            <StyledTopBarButton
                theme={theme}
                active={showActions}
                onClick={() => setShowActions(active => !active)}
            >
                <PluridIconMore
                    theme={theme}
                    title="Actions"
                />
            </StyledTopBarButton>

            {showActions && (
                <StyledActionsMenu
                    theme={theme}
                    style={{
                        left: node.current ? node.current.offsetLeft + 'px' : '0px',
                    }}
                >
                    <PluridFormbutton
                        text="New Folder"
                        Icon={() => (
                            <DirectoryIcon
                                theme={theme}
                                color={theme.colorPrimary}
                            />
                        )}
                        atClick={() => {
                            newFolder(viewDirectory);
                            setShowActions(false);
                        }}
                        theme={theme}
                        hoverEffect={false}
                    />

                    <PluridFormbutton
                        text="New File"
                        Icon={() => (
                            <FileIcon
                                theme={theme}
                                extension=""
                                color={theme.colorPrimary}
                            />
                        )}
                        atClick={() => {
                            newFile(viewDirectory);
                            setShowActions(false);
                        }}
                        theme={theme}
                        hoverEffect={false}
                    />

                    <PluridFormitem
                        theme={theme}
                    >
                        <div>
                            Open in New Plane
                        </div>
                    </PluridFormitem>

                    <PluridFormitem
                        theme={theme}
                    >
                        <div>
                            Group By
                        </div>
                    </PluridFormitem>
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
