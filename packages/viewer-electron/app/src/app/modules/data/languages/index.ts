// #region imports
    // #region internal
    import en from './en';
    import ro from './ro';
    // #endregion internal
// #endregion imports



// #region module
const languages = {
    en,
    ro,
};


const languageSelect = (
    language: string,
) => {
    switch (language) {
        case 'english':
            return en;
        case 'română':
            return ro;
        default:
            return en;
    }
}
// #endregion module



// #region exports
export type Language = typeof en;


export {
    languages,
};


export default languageSelect;
// #endregion exports
