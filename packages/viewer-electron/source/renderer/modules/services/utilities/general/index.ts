// #region module
const getNumber = (
    value: string,
) => {
    if (typeof value !== 'string') {
        return;
    }

    if (isNaN(parseFloat(value))) {
        return;
    }

    return parseFloat(value);
}


const secondsToMMSS = (
    value: number,
) => {
    const date = new Date(0);
    date.setSeconds(value);

    const timeString = date.toISOString().substr(14, 5);

    return timeString;
}
// #endregion module



// #region exports
export {
    getNumber,
    secondsToMMSS,
};
// #endregion exports
