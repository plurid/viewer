import {
    BrowserWindow,
    TouchBar,
    nativeImage,
} from 'electron';



const {
    TouchBarButton,
    TouchBarSlider,
    TouchBarSpacer,
} = TouchBar;


// 0: 'translate'
// 1: 'rotate'
// 2: 'scale'
let transformType = -1;

let transformModeValue = 'left/right';

let sliderValue = 50;

const sizing = {
    height: 16,
    width: 16,
};

const rotateIcon = nativeImage
    .createFromPath(__dirname + '/assets/rotate.png')
    .resize(sizing);
const rotateIconInvert = nativeImage
    .createFromPath(__dirname + '/assets/rotate-invert.png')
    .resize(sizing);
const scaleIcon = nativeImage
    .createFromPath(__dirname + '/assets/scale.png')
    .resize(sizing);
const scaleIconInvert = nativeImage
    .createFromPath(__dirname + '/assets/scale-invert.png')
    .resize(sizing);
const translateIcon = nativeImage
    .createFromPath(__dirname + '/assets/translate.png')
    .resize(sizing);
const translateIconInvert = nativeImage
    .createFromPath(__dirname + '/assets/translate-invert.png')
    .resize(sizing);

const upDownIcon = nativeImage
    .createFromPath(__dirname + '/assets/up-down.png')
    .resize(sizing);
const leftRightIcon = nativeImage
    .createFromPath(__dirname + '/assets/left-right.png')
    .resize(sizing);

const showLabels = false;

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

    const transformSelectorRotate = new TouchBarButton({
        icon: transformType === 1 ? rotateIconInvert : rotateIcon,
        iconPosition: showLabels ? 'left' : 'overlay',
        label: showLabels ? 'rotate' : '',
        click: () => {
            window.webContents.send('TOUCHBAR_TRANSFORM', {
                type: 1,
                active: transformType !== 1,
            });
            transformSelect(1);
            regenerate();
        },
        backgroundColor: transformType === 1 ? 'Selected' : '',
        accessibilityLabel: 'rotate',
    });

    const transformSelectorScale = new TouchBarButton({
        icon: transformType === 2 ? scaleIconInvert : scaleIcon,
        iconPosition: showLabels ? 'left' : 'overlay',
        label: showLabels ? 'scale' : '',
        click: () => {
            window.webContents.send('TOUCHBAR_TRANSFORM', {
                type: 2,
                active: transformType !== 2,
            });
            transformSelect(2);
            regenerate();
        },
        backgroundColor: transformType === 2 ? 'Selected' : '',
        accessibilityLabel: 'scale',
    });

    const transformSelectorTranslate = new TouchBarButton({
        icon: transformType === 0 ? translateIconInvert : translateIcon,
        iconPosition: showLabels ? 'left' : 'overlay',
        label: showLabels ? 'translate' : '',
        click: () => {
            window.webContents.send('TOUCHBAR_TRANSFORM', {
                type: 0,
                active: transformType !== 0,
            });
            transformSelect(0);
            regenerate();
        },
        backgroundColor: transformType === 0 ? 'Selected' : '',
        accessibilityLabel: 'translate',
    });


    const spacer = new TouchBarSpacer({
        size: 'small',
    });


    const transformMode = new TouchBarButton({
        icon: transformModeValue === 'up/down' ? upDownIcon : leftRightIcon,
        iconPosition: showLabels ? 'left' : 'overlay',
        label: showLabels ? transformModeValue : '',
        click: () => {
            transformModeValue = transformModeValue === 'up/down'
                ? 'left/right'
                : 'up/down';
            regenerate();
        },
        // enabled: false,
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
            transformSelectorRotate,
            transformSelectorScale,
            transformSelectorTranslate,
            spacer,
            transformMode,
            slider,
        ],
    });

    return touchBar;
}



export default generateTouchBar;
