import {
    BrowserWindow,
    TouchBar,
} from 'electron';



const {
    TouchBarButton,
    TouchBarSlider,
    TouchBarSpacer,
    TouchBarSegmentedControl,
} = TouchBar;


// 0: 'translate'
// 1: 'rotate'
// 2: 'scale'
let transformType = 0;

let transformModeValue = 'left/right';

let sliderValue = 50;

const generateTouchBar = (
    window: BrowserWindow,
    regenerate: () => void,
) => {
    const transformSelect = (
        index: number,
    ) => {
        if (index !== transformType) {
            transformType = index;
        } else {
            transformType = -1;
        }
    }

    const transformSelectorTranslate = new TouchBarButton({
        label: 'translate',
        click: () => {
            transformSelect(0);
            regenerate();
        },
        backgroundColor: transformType === 0 ? 'Selected' : '',
        accessibilityLabel: 'translate',
    });

    const transformSelectorRotate = new TouchBarButton({
        label: 'rotate',
        click: () => {
            transformSelect(1);
            regenerate();
        },
        backgroundColor: transformType === 1 ? 'Selected' : '',
        accessibilityLabel: 'rotate',
    });

    const transformSelectorScale = new TouchBarButton({
        label: 'scale',
        click: () => {
            transformSelect(2);
            regenerate();
        },
        backgroundColor: transformType === 2 ? 'Selected' : '',
        accessibilityLabel: 'scale',
    });


    const spacer = new TouchBarSpacer({
        size: 'small',
    });


    const transformMode = new TouchBarButton({
        label: transformModeValue,
        click: () => {
            console.log('mode clicked');
            console.log('mode clicked', transformModeValue);
            transformModeValue = transformModeValue === 'up/down'
                ? 'left/right'
                : 'up/down';
            console.log('mode clicked', transformModeValue);
            regenerate();
        },
        enabled: false,
    });

    const slider = new TouchBarSlider({
        minValue: 0,
        maxValue: 100,
        value: sliderValue,
        change: (newValue) => {
            window.webContents.send('TOUCHBAR_SLIDER', newValue);
            sliderValue = newValue;
        },
    });

    const touchBar = new TouchBar({
        items: [
            transformSelectorTranslate,
            transformSelectorRotate,
            transformSelectorScale,
            spacer,
            transformMode,
            slider,
        ],
    });

    return touchBar;
}



export default generateTouchBar;
