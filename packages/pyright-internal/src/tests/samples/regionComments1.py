# This sample tests Pyright's handling of #region/#endregion comments

#region A
#  region B
#  endregion
#endregion

#region_not a region
#region: foo
#endregion

#region Extra endregion
#endregion
#endregion

#region
#region Unclosed region
#endregion
