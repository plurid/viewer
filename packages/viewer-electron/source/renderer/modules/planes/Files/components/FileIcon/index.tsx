// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries
// #endregion imports



// #region module
const handleExtensionText = (
    extension: string,
) => {
    let extensionText = extension.replace('.', '').toUpperCase();

    if (extensionText.length > 3) {
        return extensionText.slice(0, 3);
    }
    return extensionText;
}


export interface FileIconOwnProperties {
    theme: Theme;
    extension: string;
}

export type FileIconProperties = FileIconOwnProperties;

const FileIcon: React.FC<FileIconProperties> = (
    properties,
) => {
    // #region properties
    const {
        theme,
        extension,
    } = properties;

    const extensionText = handleExtensionText(extension);
    // #endregion properties


    // #region render
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
            <defs>
            <style>
                {
                    `
                        .cls-1 {
                            fill: ${theme.backgroundColorTertiary};
                        }

                        .cls-2 {
                            fill: ${theme.backgroundColorQuaternary};
                        }

                        .cls-3 {
                            font-size: 200px;
                            fill: #fff;
                            font-family: Ubuntu-Bold, Ubuntu;
                            font-weight: 700;
                        }

                        .cls-4 {
                            letter-spacing: 0.02em;
                        }

                        .cls-5 {
                            letter-spacing: 0.03em;
                        }
                    `
                }
            </style>
            </defs>

            <title>file</title>

            <g>
                <g>
                    <path className="cls-1" d="M169.55,46.16H574.68v253.9H830.45V953.84H169.55ZM731.9,447.07H266.29c.61,11.38,1.11,42.24,1.67,52.63H731.9ZM268,665.07H733.68c-.76-12-1.3-41.78-1.89-51.18H268Zm0,146.87H733.22c-.51-11.54-.92-42.17-1.36-52.14H267.93Z"/>
                    <path className="cls-1" d="M620.23,254.14V75.05l178,179.09Z"/>
                </g>

                {extensionText && (
                    <g>
                        <rect
                            className="cls-2"
                            x="396.5"
                            y="474"
                            width="584"
                            height="314"
                        />
                        <text
                            className="cls-3"
                            x="688.5"
                            y="661"
                            dominantBaseline="middle"
                            textAnchor="middle"
                        >
                            {extensionText}
                        </text>
                    </g>
                )}
            </g>
        </svg>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default FileIcon;
// #endregion exports
