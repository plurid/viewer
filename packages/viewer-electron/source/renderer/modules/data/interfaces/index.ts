// #region module
export interface Space {
    id: string;
    planes: Plane[];
}


export type PlaneKind =
    | 'image'
    | 'video'
    | 'sound'
    | 'text'
    | 'files';


export interface PlaneBase {
    id: string;
    kind: PlaneKind;
    // plurid data - coordinates, size, etc.
}


export interface PlaneImage extends PlaneBase {
    kind: 'image';
    data: {
        source: string;
    };
}


export interface PlaneVideo extends PlaneBase {
    kind: 'video';
    data: {
        source: string;
    };
}


export interface PlaneSound extends PlaneBase {
    kind: 'sound';
    data: {
        source: string;
    };
}


export interface PlaneText extends PlaneBase {
    kind: 'text';
    data: {
        source: string;
    };
}


export interface PlaneFiles extends PlaneBase {
    kind: 'files';
    data: {
        directory: string;
    };
}


export type Plane =
    | PlaneImage
    | PlaneVideo
    | PlaneSound
    | PlaneText
    | PlaneFiles;
// #endregion module
