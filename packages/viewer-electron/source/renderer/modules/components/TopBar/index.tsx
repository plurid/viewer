import React, {
    useState,
} from 'react';

import {
    plurid,
} from '@plurid/plurid-themes';

import {
    StyledTopBar,
} from './styled';



const theme = plurid;

const TopBar: React.FC<any> = () => {
    const [mouseOver, setMouseOver] = useState(false);

    return (
        <StyledTopBar
            onMouseEnter={() => setMouseOver(true)}
            onMouseLeave={() => setMouseOver(false)}
            onMouseMove={() => !mouseOver ? setMouseOver(true) : undefined}
            mouseOver={mouseOver}
            theme={theme}
        >
        </StyledTopBar>
    );
}


export default TopBar;
