1. remove hospital bill pdf from total tariff extraction
2. move isAllInclusivePackage from tariff extraction schema to hospital bill extraction schema
3. remove cash paid receipt, passbook statement from everywhere.


lens type approved logic (this has to be from AI side as a key/result)
if (lens type == cant determine){
  lens type app = cant determine
} elif (lens type && (tariff || benefit) says lens type is not app){
  lens type app = false
} else {
  len type app = true
} w