import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested, Matches } from "class-validator";
import { OrderDeliveryMethod, OrderPaymentMethod, OrderStatus } from "../entities";

export class CheckoutLineDto {
  @IsUUID() menuItemId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(20) quantity!: number;
}

export class CheckoutAddressDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsString() @MinLength(5) @MaxLength(700) addressLine!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class CreateOrderDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CheckoutLineDto)
  items!: CheckoutLineDto[];

  @IsEnum(OrderPaymentMethod)
  paymentMethod = OrderPaymentMethod.Offline;

  @IsEnum(OrderDeliveryMethod)
  deliveryMethod!: OrderDeliveryMethod;

  @IsOptional() @IsUUID()
  addressId?: string;

  @IsOptional() @ValidateNested() @Type(() => CheckoutAddressDto)
  newAddress?: CheckoutAddressDto;

  @IsString() @MinLength(8) @MaxLength(80)
  idempotencyKey!: string;

  @IsOptional() @IsString() @MaxLength(500)
  customerNote?: string;
}

export class UpdateOnlineOrderingSettingsDto {
  @IsOptional() @IsBoolean() pickupEnabled?: boolean;
  @IsOptional() @IsBoolean() courierEnabled?: boolean;
  @IsOptional() @IsBoolean() offlinePaymentEnabled?: boolean;
}

export class OrdersQueryDto {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) toDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus) status!: OrderStatus;
}
