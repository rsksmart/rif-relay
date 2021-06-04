import {Address} from "./Aliases";

export interface RelayData {
    manager: Address;
    penalized: boolean;
    url: string;
}
