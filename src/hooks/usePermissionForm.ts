import { useState, useEffect } from "react";
import { db, Permission } from "../db";
import { getSetting } from "../services/data";

export interface PermissionFormState {
    name: string;               setName: (v: string) => void;
    type: Permission["type"];   setType: (v: Permission["type"]) => void;
    collector: string;          setCollector: (v: string) => void;
    lat: number | null;         setLat: (v: number | null) => void;
    lon: number | null;         setLon: (v: number | null) => void;
    acc: number | null;         setAcc: (v: number | null) => void;
    landownerName: string;      setLandownerName: (v: string) => void;
    landownerPhone: string;     setLandownerPhone: (v: string) => void;
    landownerEmail: string;     setLandownerEmail: (v: string) => void;
    landownerAddress: string;   setLandownerAddress: (v: string) => void;
    landType: Permission["landType"]; setLandType: (v: Permission["landType"]) => void;
    permissionGranted: boolean; setPermissionGranted: (v: boolean) => void;
    validFrom: string;          setValidFrom: (v: string) => void;
    insuranceProvider: string;  setInsuranceProvider: (v: string) => void;
    ncmdNumber: string;         setNcmdNumber: (v: string) => void;
    ncmdExpiry: string;         setNcmdExpiry: (v: string) => void;
    detectoristName: string;    setDetectoristName: (v: string) => void;
    detectoristEmail: string;   setDetectoristEmail: (v: string) => void;
    notes: string;              setNotes: (v: string) => void;
    boundary: any | null;       setBoundary: (v: any | null) => void;
    agreementId: string | undefined; setAgreementId: (v: string | undefined) => void;
    isClubDayMember: boolean;         setIsClubDayMember: (v: boolean) => void;
    isPersonalRallyRecord: boolean;   setIsPersonalRallyRecord: (v: boolean) => void;
    isSharedPermission: boolean;      setIsSharedPermission: (v: boolean) => void;
    sharedPermissionId: string | undefined;         setSharedPermissionId: (v: string | undefined) => void;
    organiserContactNumber: string | undefined;     setOrganiserContactNumber: (v: string | undefined) => void;
    organiserEmail: string | undefined;             setOrganiserEmail: (v: string | undefined) => void;
    submittedAt: string | undefined;                setSubmittedAt: (v: string | undefined) => void;
    significantFindInstructions: string | undefined; setSignificantFindInstructions: (v: string | undefined) => void;
    clubDayPublicNotes: string | undefined;         setClubDayPublicNotes: (v: string | undefined) => void;
    loading: boolean;
}

export function usePermissionForm(
    id: string | undefined,
    searchParams: URLSearchParams,
    setError: (msg: string | null) => void,
): PermissionFormState {
    const [name, setName] = useState("");
    const [type, setType] = useState<Permission["type"]>(searchParams.get("type") === "rally" ? "rally" : "individual");
    const [collector, setCollector] = useState("");
    const [lat, setLat] = useState<number | null>(null);
    const [lon, setLon] = useState<number | null>(null);
    const [acc, setAcc] = useState<number | null>(null);
    const [landownerName, setLandownerName] = useState("");
    const [landownerPhone, setLandownerPhone] = useState("");
    const [landownerEmail, setLandownerEmail] = useState("");
    const [landownerAddress, setLandownerAddress] = useState("");
    const [landType, setLandType] = useState<Permission["landType"]>("arable");
    const [permissionGranted, setPermissionGranted] = useState(false);
    const [validFrom, setValidFrom] = useState("");
    const [insuranceProvider, setInsuranceProvider] = useState("");
    const [ncmdNumber, setNcmdNumber] = useState("");
    const [ncmdExpiry, setNcmdExpiry] = useState("");
    const [detectoristName, setDetectoristName] = useState("");
    const [detectoristEmail, setDetectoristEmail] = useState("");
    const [notes, setNotes] = useState("");
    const [boundary, setBoundary] = useState<any | null>(null);
    const [agreementId, setAgreementId] = useState<string | undefined>();
    const [isClubDayMember, setIsClubDayMember] = useState(false);
    const [isPersonalRallyRecord, setIsPersonalRallyRecord] = useState(false);
    const [isSharedPermission, setIsSharedPermission] = useState(false);
    const [sharedPermissionId, setSharedPermissionId] = useState<string | undefined>();
    const [organiserContactNumber, setOrganiserContactNumber] = useState<string | undefined>();
    const [organiserEmail, setOrganiserEmail] = useState<string | undefined>();
    const [submittedAt, setSubmittedAt] = useState<string | undefined>();
    const [significantFindInstructions, setSignificantFindInstructions] = useState<string | undefined>();
    const [clubDayPublicNotes, setClubDayPublicNotes] = useState<string | undefined>();
    const [loading, setLoading] = useState(!!id);

    useEffect(() => {
        getSetting("insuranceProvider", "").then(setInsuranceProvider);
        getSetting("ncmdNumber", "").then(setNcmdNumber);
        getSetting("ncmdExpiry", "").then(setNcmdExpiry);
        getSetting("detectorist", "").then(setDetectoristName);
        getSetting("detectoristEmail", "").then(setDetectoristEmail);

        if (id) {
            db.permissions.get(id).then(l => {
                if (l) {
                    setName(l.name);
                    setType(l.type || "individual");
                    setCollector(l.collector);
                    setLat(l.lat);
                    setLon(l.lon);
                    setAcc(l.gpsAccuracyM);
                    setLandownerName(l.landownerName || "");
                    setLandownerPhone(l.landownerPhone || "");
                    setLandownerEmail(l.landownerEmail || "");
                    setLandownerAddress(l.landownerAddress || "");
                    setLandType(l.landType);
                    setPermissionGranted(l.permissionGranted);
                    setValidFrom(l.validFrom || "");
                    setBoundary(l.boundary);
                    setAgreementId(l.agreementId);
                    setNotes(l.notes);
                    setIsClubDayMember(!!l.isClubDayMember);
                    setIsPersonalRallyRecord(!!l.isPersonalRallyRecord);
                    setIsSharedPermission(!!l.isSharedPermission);
                    setSharedPermissionId(l.sharedPermissionId);
                    setOrganiserContactNumber(l.organiserContactNumber);
                    setOrganiserEmail(l.organiserEmail);
                    setSubmittedAt(l.submittedAt);
                    setSignificantFindInstructions(l.significantFindInstructions);
                    setClubDayPublicNotes(l.clubDayPublicNotes);
                }
                setLoading(false);
            }).catch(err => {
                console.error("Failed to load permission:", err);
                setError("Could not load permission details. The database might be busy or migrating.");
                setLoading(false);
            });
        } else {
            getSetting("detectorist", "").then(setCollector);
            // Pre-fill from Discover → "Add to FindSpot" navigation
            const prefillName = searchParams.get("name");
            const prefillValidFrom = searchParams.get("validFrom");
            const prefillLandownerName = searchParams.get("landownerName");
            const prefillLat = searchParams.get("lat");
            const prefillLon = searchParams.get("lon");
            const prefillNotes = searchParams.get("notes");
            if (prefillName) setName(prefillName);
            if (prefillValidFrom) setValidFrom(prefillValidFrom);
            if (prefillLandownerName) setLandownerName(prefillLandownerName);
            if (prefillLat) setLat(parseFloat(prefillLat));
            if (prefillLon) setLon(parseFloat(prefillLon));
            if (prefillNotes) setNotes(prefillNotes);
        }
    }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        name, setName,
        type, setType,
        collector, setCollector,
        lat, setLat,
        lon, setLon,
        acc, setAcc,
        landownerName, setLandownerName,
        landownerPhone, setLandownerPhone,
        landownerEmail, setLandownerEmail,
        landownerAddress, setLandownerAddress,
        landType, setLandType,
        permissionGranted, setPermissionGranted,
        validFrom, setValidFrom,
        insuranceProvider, setInsuranceProvider,
        ncmdNumber, setNcmdNumber,
        ncmdExpiry, setNcmdExpiry,
        detectoristName, setDetectoristName,
        detectoristEmail, setDetectoristEmail,
        notes, setNotes,
        boundary, setBoundary,
        agreementId, setAgreementId,
        isClubDayMember, setIsClubDayMember,
        isPersonalRallyRecord, setIsPersonalRallyRecord,
        isSharedPermission, setIsSharedPermission,
        sharedPermissionId, setSharedPermissionId,
        organiserContactNumber, setOrganiserContactNumber,
        organiserEmail, setOrganiserEmail,
        submittedAt, setSubmittedAt,
        significantFindInstructions, setSignificantFindInstructions,
        clubDayPublicNotes, setClubDayPublicNotes,
        loading,
    };
}
