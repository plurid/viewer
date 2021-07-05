// #region imports
    // #region libraries
    import React from 'react';

    import {
        Theme,
    } from '@plurid/plurid-themes';
    // #endregion libraries
// #endregion imports



// #region module
export interface DirectoryIconProperties {
    theme: Theme;
}


const DirectoryIcon: React.FC<DirectoryIconProperties> = (
    properties,
) => {
    // #region properties
    const {
        theme,
    } = properties;
    // #endregion properties


    // #region render
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
            <defs>
                <style>
                {`
                    .cls-1 {
                        fill: ${theme.backgroundColorTertiary};
                    }

                    .cls-2 {
                        fill: ${theme.backgroundColorQuaternary};
                    }
                `}
                </style>
            </defs>

            <title>directory</title>

            <g>
                <path
                    className="cls-1"
                    d="M449.52,204.94c3.26,2.11,6.93,1.3,10.43,1.3q217.26,0,434.52,0c44,0,85.89,35.19,93.68,78.54a106.74,106.74,0,0,1,1.55,19q0,244.41-.05,488.83c0,47-31.24,86.21-76.94,96.77a97,97,0,0,1-22,2.36q-390.52-.06-781.06-.07c-55.59,0-99.15-43.49-99.17-98.83q-.11-247.1,0-494.19c0-1.77.18-3.55.27-5.33,2.27-2.64.88-5.89,1.45-8.82,8.67-44,50.33-78.22,95.47-78.22q166.53,0,333.07-.06C443.67,206.21,446.89,207.32,449.52,204.94Z"
                />
                <path
                    className="cls-2"
                    d="M449.52,204.94c-2.63,2.38-5.85,1.27-8.78,1.28q-166.53.09-333.07.06c-45.14,0-86.8,34.21-95.47,78.22-.57,2.93.82,6.18-1.45,8.82-.05-31.07-1-62.17.06-93.2,1.72-49.48,45.32-91.37,95-91.63,80.74-.42,161.49-.12,242.23-.18,3.19,0,5.76.5,8.19,3Q402.8,158.19,449.52,204.94Z"
                />
            </g>
        </svg>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default DirectoryIcon;
// #endregion exports
