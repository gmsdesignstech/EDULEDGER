ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "billingPeriod" TEXT NOT NULL DEFAULT 'year';
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SubscriptionPlan" ALTER COLUMN "teacherLimit" SET DEFAULT 0;

ALTER TABLE "Subscription" RENAME COLUMN "startsAt" TO "activationDate";
ALTER TABLE "Subscription" RENAME COLUMN "endsAt" TO "expiryDate";
ALTER TABLE "Subscription" ADD COLUMN "studentCapacity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "razorpayOrderId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "razorpayPaymentId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "razorpaySignature" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Subscription" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "Subscription_razorpayOrderId_key" ON "Subscription"("razorpayOrderId");
CREATE UNIQUE INDEX "Subscription_razorpayPaymentId_key" ON "Subscription"("razorpayPaymentId");
CREATE INDEX "Subscription_institutionId_status_expiryDate_idx" ON "Subscription"("institutionId","status","expiryDate");

INSERT INTO "SubscriptionPlan" ("id","name","price","studentLimit","teacherLimit","billingPeriod","active","features","createdAt","updatedAt") VALUES
('starter','Starter Plan',10000,250,0,'year',true,'[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('growth','Growth Plan',12000,400,0,'year',true,'[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('professional','Professional Plan',14000,550,0,'year',true,'[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('business','Business Plan',16000,700,0,'year',true,'[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('premium','Premium Plan',18000,850,0,'year',true,'[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('enterprise','Enterprise Plan',20000,1000,0,'year',true,'[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","price"=EXCLUDED."price","studentLimit"=EXCLUDED."studentLimit","billingPeriod"='year',"active"=true,"updatedAt"=CURRENT_TIMESTAMP;
