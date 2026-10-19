"use client";
import {
  ArrowUp,
  Archive, ArrowLeftRight, Badge, Banknote, BedDouble, Bell, Bike, BookOpen, Briefcase, BriefcaseBusiness, Calendar, Camera, Car, CarTaxiFront,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleEllipsis, Circle, CircleCheck, Clapperboard, Clock, CloudOff, Coffee, CreditCard, Copy,
  Delete, Download, Droplets, Dumbbell, Ellipsis, FileText, Flower2, Fuel, Gamepad2, Gift, GraduationCap, GripVertical, Hammer, HandHeart,
  Heart, HeartPulse, House, IdCard, Info, KeyRound, Lamp, Landmark, Laptop, Layers, ListFilter, Lock, LogOut, Merge, Music, NotebookPen,
  Package, Palette, PartyPopper, PawPrint, Pencil, Percent, Phone, PiggyBank, Pill, Plane, Plus, ReceiptText, Repeat, Sandwich, Scissors, Search, Settings,
  Shield, ShieldCheck, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sparkles, SprayCan, SquareParking, Stethoscope, Store, Ticket,
  TrainFront, TreePalm, Utensils, List, ChartNoAxesColumn, CloudUpload, Tags, Database, Share, SquarePlus, TriangleAlert, Trash2, Tv, Undo2, Users, Wallet, Wifi, Wine, X, Zap, SlidersHorizontal, RefreshCw, TrendingUp,
  type LucideIcon, type LucideProps,
} from "lucide-react";

/** Category icons are stored by name (lucide, kebab-case). The registry keeps the bundle to what is used. */
const REGISTRY: Record<string, LucideIcon> = {
  "key-round": KeyRound, landmark: Landmark, zap: Zap, droplets: Droplets, wifi: Wifi, shield: Shield, hammer: Hammer,
  "shopping-cart": ShoppingCart, store: Store, "spray-can": SprayCan, utensils: Utensils, bike: Bike, coffee: Coffee, sandwich: Sandwich,
  wine: Wine, "train-front": TrainFront, "car-taxi-front": CarTaxiFront, fuel: Fuel, "square-parking": SquareParking, car: Car,
  shirt: Shirt, laptop: Laptop, lamp: Lamp, package: Package, dumbbell: Dumbbell, pill: Pill, stethoscope: Stethoscope,
  scissors: Scissors, tv: Tv, ticket: Ticket, palette: Palette, "book-open": BookOpen, plane: Plane, "bed-double": BedDouble,
  "tree-palm": TreePalm, "id-card": IdCard, smartphone: Smartphone, "shield-check": ShieldCheck, briefcase: Briefcase, gift: Gift,
  "hand-heart": HandHeart, "party-popper": PartyPopper, users: Users, "notebook-pen": NotebookPen, badge: Badge, repeat: Repeat,
  banknote: Banknote, "triangle-alert": TriangleAlert, "circle-ellipsis": CircleEllipsis, house: House, "heart-pulse": HeartPulse,
  clapperboard: Clapperboard, receipt: ReceiptText, "graduation-cap": GraduationCap, "shopping-bag": ShoppingBag,
  "briefcase-business": BriefcaseBusiness, sparkles: Sparkles, percent: Percent, "undo-2": Undo2, plus: Plus, circle: Circle,
  "piggy-bank": PiggyBank, "paw-print": PawPrint, music: Music, "gamepad-2": Gamepad2, camera: Camera, "flower-2": Flower2,
  heart: Heart, phone: Phone, wallet: Wallet, layers: Layers,
};

/** The 48 icons offered when creating a category (CAT-03). */
export const PICKER_ICONS: string[] = [
  "house", "key-round", "zap", "droplets", "wifi", "shopping-cart", "store", "utensils", "coffee", "wine", "sandwich", "bike",
  "train-front", "car", "car-taxi-front", "fuel", "plane", "bed-double", "tree-palm", "shopping-bag", "shirt", "laptop", "smartphone",
  "package", "heart-pulse", "dumbbell", "pill", "scissors", "clapperboard", "tv", "ticket", "palette", "book-open", "music", "gamepad-2",
  "gift", "party-popper", "hand-heart", "users", "paw-print", "graduation-cap", "briefcase", "receipt", "landmark", "banknote",
  "piggy-bank", "camera", "flower-2",
];

export function CategoryIcon({ name, size = 20, ...rest }: { name: string | null | undefined; size?: number } & Omit<LucideProps, "size">) {
  const Icon = (name && REGISTRY[name]) || Circle;
  return <Icon size={size} strokeWidth={1.75} aria-hidden {...rest} />;
}

/** UI glyphs, one place so stroke weight stays consistent (1.75). */
export const UI = {
  Archive, ArrowLeftRight, ArrowUp, Bell, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock, CloudOff, CreditCard, Copy,
  Delete, Download, Ellipsis, FileText, GripVertical, Info, ListFilter, Lock, LogOut, Merge, Pencil, Plus, RefreshCw, Search, Settings,
  SlidersHorizontal, Sparkles, Trash2, List, ChartNoAxesColumn, CloudUpload, Tags, Database, Share, SquarePlus, House, ShieldCheck, Bike, TrendingUp, Wallet, X, ChevronDownIcon: ChevronDown, Landmark, PiggyBank, Banknote,
};
export type { LucideIcon };
